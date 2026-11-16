import { useState, useSyncExternalStore } from 'react';
import { distinctSelection, foodGroups, formatDate, formatMoney, kindLabels, ratingLabel } from './model';
import { getNutritionSnapshot, subscribeNutrition } from './store';
import type { FoodEntry, FoodKind } from './types';

function FoodCard({ entry }: { entry: FoodEntry }) {
  const verdict = entry.tolerated === 'yes' ? 'Подходит' : entry.tolerated === 'no' ? 'Не подошёл' : 'Наблюдаем';
  const tone = entry.tolerated === 'yes' ? 'positive' : entry.tolerated === 'no' ? 'negative' : 'neutral';
  return <article className="food-entry">
    <div className="food-entry-head">
      <div><span className="food-entry-kind">{kindLabels[entry.kind] || 'Корм'}</span><h3>{entry.food}</h3>{entry.brand ? <p>{entry.brand}</p> : null}</div>
      <span className={`food-verdict ${tone}`}>{verdict}</span>
    </div>
    <div className="food-entry-assessment">
      <span><span className="food-assessment-label">Аппетит</span><strong>{entry.liked === 'yes' ? 'Ест охотно' : entry.liked === 'no' ? 'Не понравился' : 'Пока не оценён'}</strong></span>
      <span><span className="food-assessment-label">Переносимость</span><strong>{entry.tolerated === 'yes' ? 'Без замечаний' : entry.tolerated === 'no' ? 'Есть замечания' : 'Наблюдаем'}</strong></span>
    </div>
    {entry.reactions?.length ? <div className="food-entry-reaction"><strong>Наблюдения</strong><p>{entry.reactions.join(', ')}</p></div> : null}
    {entry.notes ? <p className="food-entry-note">{entry.notes}</p> : null}
    <footer><time dateTime={entry.date}>{formatDate(entry.date)}</time>{entry.price ? <span>{formatMoney(entry.price)} за упаковку</span> : null}</footer>
  </article>;
}

function FoodVerdicts({ groups, want }: { groups: FoodEntry[][]; want: 'yes' | 'no' }) {
  const matching = groups.filter(group => group.some(entry => entry.tolerated === want));
  return matching.length ? matching.map(group => {
    const latest = group[group.length - 1];
    const related = group.filter(entry => entry.tolerated === want);
    const note = want === 'no'
      ? related.flatMap(entry => entry.reactions || []).concat(related.flatMap(entry => entry.notes ? [entry.notes] : [])).filter(Boolean).join(' · ') || 'Причина не указана'
      : `По ${related.length} ${related.length === 1 ? 'записи' : 'записям'} владельца`;
    return <div className="record" key={latest.id}><b>{latest.food}</b><p>{note}</p></div>;
  }) : <p className="empty">Пока нет таких оценок.</p>;
}

function summary(group: FoodEntry[]) {
  return {
    name: group[group.length - 1].food,
    liked: group.map(entry => ratingLabel(entry.liked)).join(', '),
    tolerated: group.map(entry => ratingLabel(entry.tolerated)).join(', '),
    reactions: group.flatMap(entry => entry.reactions || []).join(', ') || 'Не отмечены',
    price: group.flatMap(entry => entry.price ? [formatMoney(entry.price)] : []).join(', ') || '—',
    notes: group.flatMap(entry => entry.notes ? [entry.notes] : []).join(' · ') || '—',
  };
}
const comparisonRows = [['Понравился', 'liked'], ['Подошёл', 'tolerated'], ['Реакции', 'reactions'], ['Цена', 'price'], ['Заметки', 'notes']] as const;

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
        <div className="panel-head"><h2>Журнал кормов и реакций</h2><div className="row">
          <button className="btn tiny" type="button" onClick={onAdd}>+ Добавить корм</button>
          <select id="food-filter" aria-label="Тип питания" value={filter} onChange={event => setFilter(event.target.value as FoodKind | 'all')}>
            <option value="all">Все записи</option><option value="food">Основной корм</option><option value="treat">Лакомства</option><option value="supplement">Добавки</option>
          </select>
        </div></div>
        <div id="food-journal" className="record-list">
          {rows.length ? rows.map(entry => <FoodCard key={entry.id} entry={entry} />) : <div className="food-journal-empty"><h3>У каждого питомца свой вкус</h3><p>Добавьте первый корм, чтобы сохранить состав рациона и наблюдения за реакцией.</p><button type="button" className="btn primary" id="food-journal-add" onClick={onAdd}>Добавить корм</button></div>}
        </div>
      </div>
      <div className="grid2">
        <div className="panel glass"><h2>Подошли</h2><div id="suitable-foods" className="record-list"><FoodVerdicts groups={groups} want="yes" /></div></div>
        <div className="panel glass"><h2>Не подошли</h2><div id="unsuitable-foods" className="record-list"><FoodVerdicts groups={groups} want="no" /></div></div>
      </div>
      <div className="panel glass">
        <div className="panel-head"><h2>Сравнение кормов</h2><span className="small">По записям владельца</span></div>
        <div className="compare-selects-row" hidden={groups.length < 2}>
          <select id="compare-a" aria-label="Первый корм" value={a} onChange={event => changeSelection(0, Number(event.target.value))}>{groups.map((group, index) => <option key={group[0].id} value={index}>{group[group.length - 1].food}</option>)}</select>
          <select id="compare-b" aria-label="Второй корм" value={b} onChange={event => changeSelection(1, Number(event.target.value))}>{groups.map((group, index) => <option key={group[0].id} value={index}>{group[group.length - 1].food}</option>)}</select>
        </div>
        <div id="comparison" className="table-wrap">
          {first && second ? <table className="compare"><thead><tr><th scope="col">Параметр</th><th scope="col">{first.name}</th><th scope="col">{second.name}</th></tr></thead><tbody>{comparisonRows.map(([label, key]) => <tr key={key}><th scope="row">{label}</th><td>{first[key]}</td><td>{second[key]}</td></tr>)}</tbody></table> : <><p className="empty">Добавьте ещё {groups.length ? 'один корм' : 'два корма'} для сравнения.</p><button type="button" className="btn tiny" id="add-comparison-food" onClick={onAdd}>Добавить корм</button></>}
        </div>
      </div>
  </div>;
}

export function NutritionTools() {
  const snapshot = useSyncExternalStore(subscribeNutrition, getNutritionSnapshot, getNutritionSnapshot);
  return <details className="secondary-details food-tools">
    <summary>Подбор и сравнение кормов</summary>
    <NutritionContent key={snapshot.resetVersion} entries={snapshot.entries} onAdd={snapshot.onAdd} />
  </details>;
}
