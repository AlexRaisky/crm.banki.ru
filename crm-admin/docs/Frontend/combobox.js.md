---
tags: [frontend, ui, combobox, javascript]
---

# combobox.js

Переиспользуемый редактируемый выпадающий список без костылей. IIFE, публикует `window.Combobox`. Заменяет старый механизм `showDropdown`/`hideDropdown`/`filterDropdown` (см. ниже).

## Контракт разметки

```html
<div class="combo">
  <input class="combo-input ..." ...>
  <div class="combo-pop"></div>
</div>
```

- `.combo` — обёртка (по ней определяется «клик снаружи»).
- `.combo-input` — поле свободного ввода; по этому классу combobox сам привязывается при `attach`.
- `.combo-pop` — контейнер подсказок; получает класс `open` когда открыт, наполняется `div.combo-item` (у активного пункта класс `active`).

### Откуда берутся варианты — `optionsOf(input)` (`combobox.js:18`)
Приоритет: 1) `input._comboOptions` (заданные программно); 2) атрибут `data-options='["a","b"]'` (JSON); 3) fallback — элементы `[data-seed]` внутри соседнего `.combo-pop` (совместимость со старой разметкой). Иначе `[]`.

## API `window.Combobox`

| Метод | Действие |
|---|---|
| `attach(root)` | Привязывает все `input.combo-input` внутри `root` (по умолчанию `document`): ставит `autocomplete="off"`, вешает `focus`/`input`/`keydown`. Идемпотентно (флаг `input._comboBound`). |
| `setOptions(input, opts)` | Задаёт массив вариантов конкретному input (в `input._comboOptions`). |
| `setOptionsFor(selector, opts)` | Задаёт одинаковые варианты всем элементам по CSS-селектору. |
| `close()` | Закрывает текущий открытый список (снимает `open`, чистит `.combo-pop`). |

Модуль хранит единственный открытый список в переменной `OPEN = {input, pop, items, active}`.

## Поведение

**Отрисовка `render(input, filter)`** (`combobox.js:42`): фильтрует опции по подстроке (case-insensitive), берёт первые 200, создаёт `div.combo-item`. Пустой список закрывает popup.

**Мышь**: клик по пункту навешен на `mousedown` c `e.preventDefault()` — input не теряет фокус до присвоения. Проставляет `input.value`, диспатчит события `input` и `change` (bubbles), закрывает список, возвращает фокус.

**Клавиатура `onKey`** (`combobox.js:83`), только для `.combo-input`:
- `ArrowDown` — открыть (если закрыт) или сдвинуть выделение вниз;
- `ArrowUp` — сдвинуть выделение вверх;
- `Enter` — выбрать активный пункт (диспатч `mousedown`);
- `Escape` — закрыть.

`setActive(delta)` (`combobox.js:72`) циклически двигает выделение (`(active+delta+n)%n`) и `scrollIntoView({block:"nearest"})`.

**Закрытие по клику вне**: глобальный слушатель `document` на `mousedown` (не `blur` — чтобы не было гонки с `onblur`), закрывает если клик вне `OPEN.input.parentNode`.

Инициализация: `attach(document)` на `DOMContentLoaded`.

## Чем заменён старый «костыль»

В `index.html` остались устаревшие функции `showDropdown` / `hideDropdown` / `hideDropdownComname` / `filterDropdown` (`index.html:3906+`), работавшие через `input.nextElementSibling` и `setTimeout(...150)` на `blur`. Новый `combobox.js` устраняет гонку `onblur`, даёт клавиатурную навигацию, фильтрацию и программное задание опций. В формах мастера используется именно `combobox.js` (класс `combo-input comname`), инициализируемый из [[wizard.js]].

## Источник

- `src/main/resources/static/combobox.js` (весь файл, 1–130)
- `src/main/resources/static/index.html` (устаревший `showDropdown` `3906`)
