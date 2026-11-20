import { uiText } from '../../i18n';
import { useState, useSyncExternalStore } from 'react';
import { distinctSelection, foodGroups, formatDate, formatMoney, kindLabels, ratingLabel } from './model';
import { getNutritionSnapshot, subscribeNutrition } from './store';
import type { FoodEntry, FoodKind } from './types';

function FoodCard({ entry }: { entry: FoodEntry }) {
  const verdict = entry.tolerated === 'yes' ? uiText("Подходит") : entry.tolerated === 'no' ? uiText("Не подошёл") : uiText("Наблюдаем");
  const tone = entry.tolerated === 'yes' ? 'positive' : entry.tolerated === 'no' ? 'negative' : 'neutral';
  return <article className="food-entry">
    <div className="food-entry-head">
      <div><span className="food-entry-kind">{kindLabels[entry.kind] || uiText("Корм")}</span><h3>{entry.food}</h3>{entry.brand ? <p>{entry.brand}</p> : null}</div>
      <span className={`food-verdict ${tone}`}>{verdict}</span>
    </div>
    <div className="food-entry-assessment">
      <span><span className="food-assessment-label">{uiText("Аппетит")}</span><strong>{entry.liked === 'yes' ? uiText("Ест охотно") : entry.liked === 'no' ? uiText("Не понравился") : uiText("Пока не оценён")}</strong></span>
      <span><span className="food-assessment-label">{uiText("Переносимость")}</span><strong>{entry.tolerated === 'yes' ? uiText("Без замечаний") : entry.tolerated === 'no' ? uiText("Есть замечания") : uiText("Наблюдаем")}</strong></span>
    </div>
    {entry.reactions?.length ? <div className="food-entry-reaction"><strong>{uiText("Наблюдения")}</strong><p>{entry.reactions.join(', ')}</p></div> : null}
    {entry.notes ? <p className="food-entry-note">{entry.notes}</p> : null}
    <footer><time dateTime={entry.date}>{formatDate(entry.date)}</time>{entry.price ? <span>{formatMoney(entry.price)}{" "+uiText("за упаковку")}</span> : null}</footer>
  </article>;
}

function FoodVerdicts({ groups, want }: { groups: FoodEntry[][]; want: 'yes' | 'no' }) {
  const matching = groups.filter(group => group.some(entry => entry.tolerated === want));
  return matching.length ? matching.map(group => {
    const latest = group[group.length - 1];
    const related = group.filter(entry => entry.tolerated === want);
    const note = want === 'no'
      ? related.flatMap(entry => entry.reactions || []).concat(related.flatMap(entry => entry.notes ? [entry.notes] : [])).filter(Boolean).join(' · ') || uiText("Причина не указана")
      : `${uiText("По")+" "}${related.length}${" "}${related.length === 1 ? uiText("записи") : uiText("записям")}${" "+uiText("владельца")}`;
    return <div className="record" key={latest.id}><b>{latest.food}</b><p>{note}</p></div>;
  }) : <p className="empty">{uiText("Пока нет таких оценок.")}</p>;
}

function summary(group: FoodEntry[]) {
  return {
    name: group[group.length - 1].food,
    liked: group.map(entry => ratingLabel(entry.liked)).join(', '),
    tolerated: group.map(entry => ratingLabel(entry.tolerated)).join(', '),
    reactions: group.flatMap(entry => entry.reactions || []).join(', ') || uiText("Не отмечены"),
    price: group.flatMap(entry => entry.price ? [formatMoney(entry.price)] : []).join(', ') || '—',
    notes: group.flatMap(entry => entry.notes ? [entry.notes] : []).join(' · ') || '—',
  };
}
const comparisonRows = [[uiText("Понравился"), 'liked'], [uiText("Подошёл"), 'tolerated'], [uiText("Реакции"), 'reactions'], [uiText("Цена"), 'price'], [uiText("Заметки"), 'notes']] as const;

function NutritionContent({ entries, onAdd }: { entries: readonly FoodEntry[]; onAdd: () => void }) {
  const [filter, setFilter] = useState<FoodKind | 'all'>('all');
  const [selected, setSelected] = useState<[number, number]>([0, 1]);
  const rows = entries.filter(entry => filter === 'all' || entry.kind === filter).sort((a, b) => b.date.localeCompare(a.date));
  const groups = foodGroups(entries.filter(entry => entry.kind === 'food'));
  const [a, b] = distinctSelection(groups, selected);
  const changeSelection = (side: 0 | 1, value: number) => {
    const next: [number, number] = [a, b];
    next[side] = value;
    if (next[0] === next[1]) next[side === 0 ? 1 : 0] = groups.findIndex((_, index) => index !== value);
    setSelected(next);
  };
  const first = groups.length > 1 ? summary(groups[a]) : null;
  const second = groups.length > 1 ? summary(groups[b]) : null;
  return <div className="food-tools-content">
      <div className="panel glass">
        <div className="panel-head"><h2>{uiText("Журнал кормов и реакций")}</h2><div className="row">
          <button className="btn tiny" type="button" onClick={onAdd}>{"+ "+uiText("Добавить корм")}</button>
          <select id="food-filter" aria-label={uiText("Тип питания")} value={filter} onChange={event => setFilter(event.target.value as FoodKind | 'all')}>
            <option value="all">{uiText("Все записи")}</option><option value="food">{uiText("Основной корм")}</option><option value="treat">{uiText("Лакомства")}</option><option value="supplement">{uiText("Добавки")}</option>
          </select>
        </div></div>
        <div id="food-journal" className="record-list">
          {rows.length ? rows.map(entry => <FoodCard key={entry.id} entry={entry} />) : <div className="food-journal-empty"><h3>{uiText("У каждого питомца свой вкус")}</h3><p>{uiText("Добавьте первый корм, чтобы сохранить состав рациона и наблюдения за реакцией.")}</p><button type="button" className="btn primary" id="food-journal-add" onClick={onAdd}>{uiText("Добавить корм")}</button></div>}
        </div>
      </div>
      <div className="grid2">
        <div className="panel glass"><h2>{uiText("Подошли")}</h2><div id="suitable-foods" className="record-list"><FoodVerdicts groups={groups} want="yes" /></div></div>
        <div className="panel glass"><h2>{uiText("Не подошли")}</h2><div id="unsuitable-foods" className="record-list"><FoodVerdicts groups={groups} want="no" /></div></div>
      </div>
      <div className="panel glass">
        <div className="panel-head"><h2>{uiText("Сравнение кормов")}</h2><span className="small">{uiText("По записям владельца")}</span></div>
        <div className="compare-selects-row" hidden={groups.length < 2}>
          <select id="compare-a" aria-label={uiText("Первый корм")} value={a} onChange={event => changeSelection(0, Number(event.target.value))}>{groups.map((group, index) => <option key={group[0].id} value={index}>{group[group.length - 1].food}</option>)}</select>
          <select id="compare-b" aria-label={uiText("Второй корм")} value={b} onChange={event => changeSelection(1, Number(event.target.value))}>{groups.map((group, index) => <option key={group[0].id} value={index}>{group[group.length - 1].food}</option>)}</select>
        </div>
        <div id="comparison" className="table-wrap">
          {first && second ? <table className="compare"><thead><tr><th scope="col">{uiText("Параметр")}</th><th scope="col">{first.name}</th><th scope="col">{second.name}</th></tr></thead><tbody>{comparisonRows.map(([label, key]) => <tr key={key}><th scope="row">{label}</th><td>{first[key]}</td><td>{second[key]}</td></tr>)}</tbody></table> : <p className="empty">{uiText("Добавьте ещё")+" "}{groups.length ? uiText("один корм") : uiText("два корма")}{" "+uiText("для сравнения.")}</p>}
        </div>
      </div>
  </div>;
}

export function NutritionTools() {
  const snapshot = useSyncExternalStore(subscribeNutrition, getNutritionSnapshot, getNutritionSnapshot);
  return <details className="secondary-details food-tools" open>
    <summary>{uiText("Подбор и сравнение кормов")}</summary>
    <NutritionContent key={snapshot.resetVersion} entries={snapshot.entries} onAdd={snapshot.onAdd} />
  </details>;
}
