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

    public TemplateService(TemplateStore store, AuditContext audit,
                           AdminLogService adminLog, UnifiedTemplateService unified) {
        this.store = store;
        this.audit = audit;
        this.adminLog = adminLog;
        this.unified = unified;
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
        audit.mark();
        String channel = norm(dto.getChannel());
        if (!List.of("sms", "push", "email", "cc", "fa", "vk", "la").contains(channel)) {
            throw badChannel(dto.getChannel());
        }
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
        adminLog.logTable("template.d_template", "INSERT", store.rowJson(channel, codeStr));
        unified.enqueueProdSync(channel, "INSERT", code, store.prodPayload(channel, codeStr));
        return codeStr;
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
            created.add(create(copy));
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
        // old_row: состояние ДО изменения
        adminLog.logTable("template.d_template", "UPDATE", store.rowJson(ch, code));
        dto.setChannel(ch);
        store.update(ch, code, dto);
        unified.enqueueProdSync(ch, "UPDATE", Long.parseLong(code.trim()), store.prodPayload(ch, code));
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
