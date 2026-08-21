package ru.banki.crm.service;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import ru.banki.crm.dto.ChainRequest;
import ru.banki.crm.dto.TemplateDto;
import ru.banki.crm.dto.TemplateListItemDto;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * CRUD шаблонов новой архитектуры. Единственное хранилище — template.d_template
 * (см. {@link TemplateStore}); канальные таблицы notice и callcenter не читаются
 * и не пишутся. В прод-БД строка уезжает очередью синка (app.prod_sync) уже
 * собранной в прод-структуру.
 */
@Service
public class TemplateService {

    private final TemplateStore store;
    private final AuditContext audit;
    private final AdminLogService adminLog;
    private final UnifiedTemplateService unified;
    private final ru.banki.crm.service.prod.ProdDbService prodDb;

    public TemplateService(TemplateStore store, AuditContext audit,
                           AdminLogService adminLog, UnifiedTemplateService unified,
                           ru.banki.crm.service.prod.ProdDbService prodDb) {
        this.store = store;
        this.audit = audit;
        this.adminLog = adminLog;
        this.unified = unified;
        this.prodDb = prodDb;
    }

    /**
     * Пре-флайт перед постановкой в очередь: сверяем payload с колонками прод-таблицы,
     * которые NOT NULL и без DEFAULT.
     *
     * Зачем: доставка в прод асинхронная (очередь разгребается раз в 20 с), и отказ прода
     * всплывал уже после того, как пользователь увидел «шаблон создан» и ушёл — шаблон
     * оставался только у нас, а запись висела в ERROR. Бросаем 400 ДО коммита: методы
     * транзакционные, поэтому локальная строка не остаётся, а карточка в мастере не чистится
     * (она чистится только по успеху) и набранное не теряется.
     *
     * Прод не настроен или недоступен → список пуст, поведение прежнее.
     */
    private void requireProdAccepts(String channel, String payload) {
        List<String> missing = prodDb.missingRequired(channel, payload);
        if (missing.isEmpty()) return;
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                "Прод не примет шаблон: не заполнены обязательные поля — " + String.join(", ", missing));
    }

    // ------------------------------------------------- ОБЯЗАТЕЛЬНЫЕ ПОЛЯ КАРТОЧКИ

    /** Обязательное поле: подпись как в карточке и способ достать значение. */
    private record Req(String label, java.util.function.Function<TemplateDto, Object> get) {}

    /**
     * Поля, без которых шаблон не заводится. Тот же список, что и в карточке
     * (SFD_REQUIRED в template-details.js), но проверяется здесь: форму можно обойти —
     * запросом в API, материализацией цепочки, импортом. Раз правило про то, что уедет
     * в прод, держать его должен сервер, а форма лишь показывает это заранее.
     * <p>
     * Набор зависит от канала: у письма нет текста сообщения (контент в Letteros),
     * у КЦ — ни текста, ни отправителя, «Sender name» есть только у sms.
     */
    private static List<Req> requiredFields(String channel) {
        List<Req> r = new ArrayList<>(List.of(
                new Req("Communication name", TemplateDto::getCommunicationName),
                new Req("Trigger type", TemplateDto::getTriggerType),
                new Req("Product type", TemplateDto::getProductType),
                new Req("Partner name", TemplateDto::getPartnerName),
                new Req("Touch point", TemplateDto::getTouchPoint),
                new Req("Sending day", TemplateDto::getSendingDay),
                new Req("Communication tunnel", TemplateDto::getCommunicationType),
                new Req("Business communication type", TemplateDto::getBusinessCommunicationType),
                new Req("Landing page", TemplateDto::getAffSub3)));
        if ("email".equals(channel)) {
            r.add(new Req("Letteros ID", TemplateDto::getLetterosId));
        } else if (!"cc".equals(channel)) {
            r.add(new Req("Message text", TemplateDto::getMsgText));
            if ("sms".equals(channel)) r.add(new Req("Sender name", TemplateDto::getSenderName));
        }
        return r;
    }

    /**
     * Проверка обязательных полей.
     * <p>
     * При правке ({@code old} не null) спрашиваем только за то, что <b>очищают</b>: у
     * шаблонов, заведённых до этого правила, часть полей пуста, и запрещать их правку
     * целиком значило бы запереть старые карточки — поправить текст было бы нельзя,
     * пока не заполнишь всё остальное. Стереть уже заполненное по-прежнему нельзя.
     */
    private void requireFilled(String channel, TemplateDto dto, TemplateDto old) {
        List<String> missing = new ArrayList<>();
        for (Req r : requiredFields(channel)) {
            if (!blank(r.get().apply(dto))) continue;
            if (old != null && blank(r.get().apply(old))) continue;   // было пусто — не запираем
            missing.add(r.label());
        }
        if (missing.isEmpty()) return;
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                "Не заполнены обязательные поля: " + String.join(", ", missing));
    }

    private static boolean blank(Object v) {
        if (v == null) return true;
        if (v instanceof String s) return s.isBlank();
        if (v instanceof java.util.Collection<?> c) return c.isEmpty()
                || c.stream().allMatch(x -> x == null || String.valueOf(x).isBlank());
        return false;
    }

    // ------------------------------------------------------------------- LIST
    @Transactional(readOnly = true)
    public List<TemplateListItemDto> list(List<String> channel, List<String> product, List<String> touch,
                                          List<String> trigger, List<String> partner, String active, String q,
                                          String sort, String dir, Integer limit, Integer offset) {
        // сортируем ВСЮ отфильтрованную выборку и только потом режем страницу,
        // иначе порядок был бы виден лишь внутри загруженных строк
        var s = filtered(channel, product, touch, trigger, partner, active, q)
                .sorted(comparator(sort, "desc".equalsIgnoreCase(dir)));
        if (offset != null && offset > 0) s = s.skip(offset);   // пагинация: пропускаем уже загруженные
        if (limit != null && limit > 0) s = s.limit(limit);
        return s.toList();
    }

    /** Сортировка списка по колонке таблицы. Числовые коды сравниваем как числа («9» < «10»). */
    private static java.util.Comparator<TemplateListItemDto> comparator(String sort, boolean desc) {
        java.text.Collator ru = java.text.Collator.getInstance(new java.util.Locale("ru"));
        java.util.Comparator<TemplateListItemDto> c = switch (sort == null ? "" : sort) {
            case "channel" -> java.util.Comparator.comparing(i -> nz(i.channel()), ru);
            case "name"    -> java.util.Comparator.comparing(i -> nz(i.communicationName()), ru);
            case "product" -> java.util.Comparator.comparing(TemplateService::firstProduct, ru);
            case "touch"   -> java.util.Comparator.comparing(i -> nz(i.touchPoint()), ru);
            case "trigger" -> java.util.Comparator.comparing(i -> nz(i.triggerType()), ru);
            case "partner" -> java.util.Comparator.comparing(i -> nz(i.partnerName()), ru);
            case "active"  -> java.util.Comparator.comparingInt(i -> Boolean.TRUE.equals(i.active()) ? 1 : 0);
            // колонка «Live Activity» в списке: она вычисляется из канала, отдельного поля нет
            case "is_la"   -> java.util.Comparator.comparingInt(i -> "la".equals(i.channel()) ? 1 : 0);
            // колонки Source type и Letteros ID: без своих веток сортировка по ним молча
            // уходила бы в default (порядок по code) — список сортировался бы «не туда»
            case "source"   -> java.util.Comparator.comparing(i -> nz(i.sourceType()), ru);
            case "letteros" -> java.util.Comparator.comparing(i -> nz(i.letterosId()), ru);
            // по умолчанию и для "code" — числовой порядок кода, нечисловые в конец
            default -> java.util.Comparator.comparingDouble((TemplateListItemDto i) -> codeNum(i.code()))
                    .thenComparing(i -> nz(i.code()), ru);
        };
        // стабильный доп. ключ, чтобы страницы не «плавали» при равных значениях
        c = c.thenComparing(i -> nz(i.channel())).thenComparingDouble(i -> codeNum(i.code()));
        return desc ? c.reversed() : c;
    }

    private static String nz(String s) { return s == null ? "" : s; }

    private static String firstProduct(TemplateListItemDto i) {
        return (i.productType() == null || i.productType().isEmpty()) ? "" : nz(i.productType().get(0));
    }

    /** Код как число; нечисловой — в конец сортировки. */
    private static double codeNum(String code) {
        if (code == null || code.isBlank()) return Double.MAX_VALUE;
        try { return Double.parseDouble(code.trim()); }
        catch (NumberFormatException e) { return Double.MAX_VALUE; }
    }

    /** Наборы значений для выпадающих фильтров списка — из реальных данных d_template,
     *  а не хардкод (иначе фильтр по несуществующему значению всегда даёт пусто). */
    @Transactional(readOnly = true)
    public java.util.Map<String, java.util.List<String>> facets() {
        java.util.TreeSet<String> products = new java.util.TreeSet<>();
        java.util.TreeSet<String> touches = new java.util.TreeSet<>();
        java.util.TreeSet<String> triggers = new java.util.TreeSet<>();
        java.util.TreeSet<String> partners = new java.util.TreeSet<>();
        for (var i : store.list()) {
            if (i.productType() != null)
                for (var p : i.productType()) if (p != null && !p.isBlank()) products.add(p);
            if (i.touchPoint() != null && !i.touchPoint().isBlank()) touches.add(i.touchPoint());
            if (i.triggerType() != null && !i.triggerType().isBlank()) triggers.add(i.triggerType());
            if (i.partnerName() != null && !i.partnerName().isBlank()) partners.add(i.partnerName());
        }
        return java.util.Map.of(
                "products", new java.util.ArrayList<>(products),
                "touches", new java.util.ArrayList<>(touches),
                "triggers", new java.util.ArrayList<>(triggers),
                "partners", new java.util.ArrayList<>(partners));
    }

    /** Счётчик под теми же фильтрами (для строки «всего N, активных M») — без выгрузки строк на клиент. */
    @Transactional(readOnly = true)
    public java.util.Map<String, Long> count(List<String> channel, List<String> product, List<String> touch,
                                             List<String> trigger, List<String> partner, String active, String q) {
        var rows = filtered(channel, product, touch, trigger, partner, active, q).toList();
        long total = rows.size();
        long act = rows.stream().filter(i -> Boolean.TRUE.equals(i.active())).count();
        return java.util.Map.of("total", total, "active", act);
    }

    /** Выбранные значения фильтра без пустых (пустой список = фильтр не задан). */
    private static List<String> clean(List<String> selected) {
        if (selected == null) return List.of();
        return selected.stream().filter(s -> s != null && !s.isBlank()).toList();
    }

    /** Пусто = фильтр не задан. Иначе строка проходит, если её значение есть в списке (OR внутри фильтра). */
    private static boolean anyOf(List<String> selected, String value) {
        var vals = clean(selected);
        return vals.isEmpty() || vals.contains(value);
    }

    /** Общий пайплайн фильтрации (канал/продукт/точка/триггер/партнёр/статус + свободный поиск q).
     *  Внутри каждого фильтра — OR по выбранным значениям, между фильтрами — AND. */
    private java.util.stream.Stream<TemplateListItemDto> filtered(List<String> channel, List<String> product,
                                                                  List<String> touch, List<String> trigger,
                                                                  List<String> partner, String active, String q) {
        String needle = q == null ? "" : q.trim().toLowerCase();
        return store.list().stream()
                .filter(i -> anyOf(channel, i.channel()))
                .filter(i -> anyOf(touch, i.touchPoint()))
                .filter(i -> anyOf(trigger, i.triggerType()))
                .filter(i -> anyOf(partner, i.partnerName()))
                // продукт — у самой строки это список: проходит, если пересекается с выбранными
                .filter(i -> {
                    var sel = clean(product);
                    return sel.isEmpty()
                            || (i.productType() != null && i.productType().stream().anyMatch(sel::contains));
                })
                .filter(i -> active == null || active.isBlank()
                        || ("active".equals(active) == Boolean.TRUE.equals(i.active())))
                .filter(i -> needle.isEmpty() || matches(i, needle));
    }

    /** Поиск как в списке на клиенте: code / название / продукт / партнёр / точка / триггер / source. */
    private static boolean matches(TemplateListItemDto i, String needle) {
        return contains(i.code(), needle)
                || contains(i.communicationName(), needle)
                || contains(i.partnerName(), needle)
                || contains(i.touchPoint(), needle)
                || contains(i.triggerType(), needle)
                || contains(i.sourceType(), needle)
                || contains(i.letterosId(), needle)
                || (i.productType() != null && i.productType().stream().anyMatch(p -> contains(p, needle)));
    }

    private static boolean contains(String v, String needle) {
        return v != null && v.toLowerCase().contains(needle);
    }

    // -------------------------------------------------------------------- GET
    @Transactional(readOnly = true)
    public TemplateDto get(String channel, String code) {
        return store.get(norm(channel), code);
    }

    // ----------------------------------------------------------------- CREATE
    @Transactional
    public String create(TemplateDto dto) {
        return create(dto, false);
    }

    /**
     * @param forceSource создавать, даже если шаблон с таким source уже есть. Нужно для
     *                    осознанных повторов: дни цепочки и А/Б-пары делят одно имя
     *                    кампании, и запрет по source сломал бы их заведение. На проверку
     *                    letteros_id не влияет — там совпадение означает то же самое письмо.
     */
    @Transactional
    public String create(TemplateDto dto, boolean forceSource) {
        audit.mark();
        String channel = norm(dto.getChannel());
        if (!List.of("sms", "push", "email", "cc", "fa", "vk", "la").contains(channel)) {
            throw badChannel(dto.getChannel());
        }
        requireFilled(channel, dto, null);
        requireNotDuplicate(channel, dto, forceSource);
        long code;
        if ("cc".equals(channel)) {
            // у КЦ бизнес-ключ (segment) задаёт пользователь
            if (dto.getCode() == null || dto.getCode().isBlank()) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Для КЦ обязателен номер сегмента");
            }
            code = Long.parseLong(dto.getCode().trim());
            if (store.exists(channel, String.valueOf(code))) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "Сегмент уже заведён: " + code);
            }
        } else {
            code = store.nextCode(channel);
        }
        store.insert(channel, code, dto);

        String codeStr = String.valueOf(code);
        String payload = store.prodPayload(channel, codeStr);
        requireProdAccepts(channel, payload);
        adminLog.logTable("template.d_template", "INSERT", store.rowJson(channel, codeStr));
        unified.enqueueProdSync(channel, "INSERT", code, payload);
        return codeStr;
    }

    /**
     * Не заводим второй раз то, что уже заведено.
     * <p>
     * Проверок две, и они разной строгости. letteros_id — точный ключ макета письма: одно
     * письмо в Letteros живёт в одном шаблоне, и совпадение здесь осмысленным не бывает,
     * поэтому его не обойти. source (campaign_name) — имя кампании: обычно совпадение
     * означает повторное нажатие «Создать», но у дней цепочки и у А/Б-пары оно общее по
     * замыслу, поэтому такой отказ снимается подтверждением (forceSource).
     */
    private void requireNotDuplicate(String channel, TemplateDto dto, boolean forceSource) {
        if ("email".equals(channel)) {
            String letteros = nz(dto.getLetterosId()).trim();
            String twin = store.findByLetterosId(channel, letteros);
            if (twin != null) {
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                        "Письмо с letteros_id " + letteros + " уже заведено — шаблон " + twin
                        + ". Откройте его вместо создания нового.");
            }
        }
        if (forceSource) return;
        String twin = store.findBySource(channel, dto.getSourceType());
        if (twin != null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Шаблон с таким source уже есть — " + channel + "/" + twin
                    + " («" + nz(dto.getSourceType()).trim() + "»).");
        }
    }

    /** Что уже занято этим source и этим letteros_id: коды шаблонов либо null. */
    @Transactional(readOnly = true)
    public Map<String, String> duplicates(String channel, String source, String letterosId) {
        String ch = norm(channel);
        Map<String, String> out = new java.util.LinkedHashMap<>();
        out.put("source", store.findBySource(ch, source));
        out.put("letterosId", "email".equals(ch) ? store.findByLetterosId(ch, letterosId) : null);
        return out;
    }

    // ------------------------------------------------------------- CREATE CHAIN
    /** Один транзакционный batch вместо N отдельных INSERT-ов (v2 крутил цикл на клиенте). */
    @Transactional
    public List<String> createChain(ChainRequest req) {
        if (req.getBase() == null || req.getDays() == null || req.getDays().isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Нужны base и непустой список days");
        }
        List<String> created = new ArrayList<>();
        for (String day : req.getDays()) {
            TemplateDto copy = cloneWithDay(req.getBase(), day);
            /* Проверку по source делаем на первом дне: у остальных оно то же самое по
               замыслу цепочки, и повторный отказ означал бы «нельзя завести цепочку
               вообще». letteros_id при этом проверяется у каждого дня — он свой. */
            created.add(create(copy, !created.isEmpty()));
        }
        return created;
    }

    private TemplateDto cloneWithDay(TemplateDto base, String day) {
        TemplateDto d = new TemplateDto();
        org.springframework.beans.BeanUtils.copyProperties(base, d);
        d.setSendingDay(day);
        return d;
    }

    // ----------------------------------------------------------------- UPDATE
    @Transactional
    public void update(String channel, String code, TemplateDto dto) {
        audit.mark();
        String ch = norm(channel);
        // состояние ДО изменения нужно дважды: в журнал и чтобы отличить «поле стёрли»
        // от «оно и было пустым» (см. requireFilled)
        TemplateDto old = store.get(ch, code);
        requireFilled(ch, dto, old);
        adminLog.logTable("template.d_template", "UPDATE", store.rowJson(ch, code));
        dto.setChannel(ch);
        store.update(ch, code, dto);
        // UPDATE, не нашедший строки в проде, превращается в INSERT — те же обязательные поля
        String payload = store.prodPayload(ch, code);
        requireProdAccepts(ch, payload);
        unified.enqueueProdSync(ch, "UPDATE", Long.parseLong(code.trim()), payload);
    }

    // ----------------------------------------------------------------- DELETE
    @Transactional
    public void delete(String channel, String code) {
        audit.mark();
        String ch = norm(channel);
        if (!store.exists(ch, code)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Шаблон не найден: " + ch + "/" + code);
        }
        // old_row: удаляемая строка; тот же payload уедет DELETE-ом в прод
        String payload = store.prodPayload(ch, code);
        adminLog.logTable("template.d_template", "DELETE", store.rowJson(ch, code));
        store.delete(ch, code);
        unified.enqueueProdSync(ch, "DELETE", Long.parseLong(code.trim()), payload);
    }

    // ------------------------------------------------------------------ helpers
    private static String norm(String channel) {
        return channel == null ? "" : channel.trim().toLowerCase();
    }

    private static ResponseStatusException badChannel(String channel) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "Неизвестный канал: " + channel);
    }
}
