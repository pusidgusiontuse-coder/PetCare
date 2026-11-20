import { language } from '../../i18n';

export interface CatalogEntry {
  ru: string;
  en: string;
  aliases: readonly string[];
}

interface Species extends CatalogEntry {
  breeds: readonly CatalogEntry[];
}

const entry = (ru: string, en: string, ...aliases: string[]): CatalogEntry => ({ ru, en, aliases });

export const other = entry('Другое', 'Other');
export const speciesCatalog: readonly Species[] = [
  { ...entry('Собака', 'Dog', 'собаки', 'пёс', 'щенок', 'dogs'), breeds: [
    entry('Лабрадор-ретривер', 'Labrador Retriever', 'лабрадор'),
    entry('Золотистый ретривер', 'Golden Retriever', 'голден ретривер'),
    entry('Немецкая овчарка', 'German Shepherd', 'овчарка'),
    entry('Французский бульдог', 'French Bulldog', 'француз'),
    entry('Вельш-корги', 'Welsh Corgi', 'корги', 'пемброк', 'кардиган'),
    entry('Померанский шпиц', 'Pomeranian', 'померанец', 'шпиц'),
    entry('Джек-рассел-терьер', 'Jack Russell Terrier', 'рассел'),
    entry('Пудель', 'Poodle', 'той пудель'), entry('Такса', 'Dachshund'),
    entry('Сибирский хаски', 'Siberian Husky', 'хаски'),
    entry('Йоркширский терьер', 'Yorkshire Terrier', 'йорк'), entry('Чихуахуа', 'Chihuahua'),
    entry('Бигль', 'Beagle'), entry('Мопс', 'Pug'), entry('Метис', 'Mixed breed', 'дворняга'),
  ] },
  { ...entry('Кошка', 'Cat', 'кошки', 'кот', 'котёнок', 'cats'), breeds: [
    entry('Мейн-кун', 'Maine Coon', 'майкун', 'мейнкун', 'мэйн кун', 'майн кун', 'main coon'),
    entry('Британская короткошёрстная', 'British Shorthair', 'британец', 'британская'),
    entry('Шотландская вислоухая', 'Scottish Fold', 'шотландец', 'скоттиш фолд'),
    entry('Сфинкс', 'Sphynx', 'канадский сфинкс', 'sphinx'),
    entry('Сиамская', 'Siamese'), entry('Бенгальская', 'Bengal'),
    entry('Русская голубая', 'Russian Blue'), entry('Персидская', 'Persian'),
    entry('Абиссинская', 'Abyssinian'), entry('Рэгдолл', 'Ragdoll', 'регдолл'),
    entry('Сибирская', 'Siberian'), entry('Домашняя короткошёрстная', 'Domestic Shorthair', 'беспородная'),
    entry('Метис', 'Mixed breed'),
  ] },
  { ...entry('Кролик', 'Rabbit', 'кролики', 'заяц', 'bunny'), breeds: [
    entry('Карликовый баран', 'Mini Lop', 'вислоухий'),
    entry('Голландский карликовый', 'Netherland Dwarf'),
    entry('Львиноголовый', 'Lionhead'), entry('Рекс', 'Rex'),
    entry('Ангорский', 'Angora'), entry('Гермелин', 'Polish rabbit'),
  ] },
  { ...entry('Хомяк', 'Hamster', 'хомяки'), breeds: [
    entry('Сирийский', 'Syrian hamster', 'золотистый'), entry('Джунгарский', 'Winter white dwarf hamster', 'джунгарик'),
    entry('Роборовского', 'Roborovski hamster'), entry('Кэмпбелла', 'Campbell’s dwarf hamster', 'кемпбелла'),
    entry('Китайский', 'Chinese hamster'),
  ] },
  { ...entry('Морская свинка', 'Guinea pig', 'морские свинки', 'cavy'), breeds: [
    entry('Американская', 'American guinea pig', 'гладкошёрстная'),
    entry('Абиссинская', 'Abyssinian guinea pig', 'розеточная'),
    entry('Перуанская', 'Peruvian guinea pig'), entry('Тедди', 'Teddy'),
    entry('Шелти', 'Silkie', 'силки'), entry('Скинни', 'Skinny pig', 'лысая'),
  ] },
  { ...entry('Крыса', 'Rat', 'крысы', 'декоративная крыса'), breeds: [
    entry('Стандарт', 'Standard'), entry('Дамбо', 'Dumbo'),
    entry('Рекс', 'Rex'), entry('Бесшёрстная', 'Hairless', 'сфинкс'),
    entry('Сатиновая', 'Satin'),
  ] },
  { ...entry('Шиншилла', 'Chinchilla', 'шиншиллы'), breeds: [
    entry('Длиннохвостая', 'Long-tailed chinchilla'), entry('Стандартный серый', 'Standard grey'),
    entry('Чёрный бархат', 'Black velvet'), entry('Бежевый', 'Beige'),
    entry('Белый Вильсона', 'Wilson white'), entry('Эбони', 'Ebony'),
  ] },
  { ...entry('Хорёк', 'Ferret', 'хорьки', 'хорек', 'фретка'), breeds: [
    entry('Соболиный', 'Sable'), entry('Альбинос', 'Albino'), entry('Шампань', 'Champagne'),
    entry('Шоколадный', 'Chocolate'), entry('Тёмноглазый белый', 'Dark-eyed white'),
  ] },
  { ...entry('Попугай или другая птица', 'Parrot or other bird', 'попугаи', 'птицы', 'канарейка', 'амадина'), breeds: [
    entry('Волнистый попугай', 'Budgerigar', 'волнистик', 'budgie'),
    entry('Корелла', 'Cockatiel', 'нимфа'), entry('Неразлучник', 'Lovebird'),
    entry('Жако', 'African grey parrot'), entry('Канарейка', 'Canary'),
    entry('Зебровая амадина', 'Zebra finch', 'амадина'),
  ] },
  { ...entry('Аквариумная рыбка', 'Aquarium fish', 'рыбы', 'рыбки', 'fish'), breeds: [
    entry('Гуппи', 'Guppy'), entry('Петушок', 'Betta', 'бетта'), entry('Золотая рыбка', 'Goldfish'),
    entry('Неон обыкновенный', 'Neon tetra', 'неон'), entry('Скалярия', 'Angelfish'),
    entry('Меченосец', 'Swordtail'),
  ] },
  { ...entry('Черепаха или другая рептилия', 'Turtle or other reptile', 'черепахи', 'рептилии', 'геккон', 'змея'), breeds: [
    entry('Красноухая черепаха', 'Red-eared slider'), entry('Среднеазиатская черепаха', 'Russian tortoise'),
    entry('Пятнистый эублефар', 'Leopard gecko', 'геккон', 'леопардовый геккон'),
    entry('Бородатая агама', 'Bearded dragon'), entry('Маисовый полоз', 'Corn snake'),
    entry('Королевский питон', 'Ball python'),
  ] },
  { ...entry('Другое животное', 'Other animal', 'другое', 'другие'), breeds: [
    entry('Африканский карликовый ёж', 'African pygmy hedgehog', 'еж', 'ёжик'),
    entry('Дегу', 'Degu'), entry('Песчанка', 'Gerbil'),
    entry('Декоративная мышь', 'Fancy mouse'), entry('Без определённой породы', 'No specific breed'),
  ] },
];

export const catalogName = (option: CatalogEntry) => option[language];

const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replaceAll('ё', 'е');
const compact = (value: string) => normalize(value).replace(/[^\p{L}\p{N}]/gu, '');

function editDistance(left: string, right: string) {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 0; i < left.length; i++) {
    const row = [i + 1];
    for (let j = 0; j < right.length; j++) {
      row.push(Math.min(previous[j + 1] + 1, row[j] + 1, previous[j] + Number(left[i] !== right[j])));
    }
    previous = row;
  }
  return previous[right.length];
}

export function searchCatalog<T extends CatalogEntry>(options: readonly T[], search: string): readonly T[] {
  const query = compact(search);
  if (!query) return options;
  const tolerance = query.length >= 6 ? 2 : query.length >= 3 ? 1 : 0;
  return options.map(option => {
    let score = Infinity;
    for (const name of [catalogName(option), option.ru, option.en, ...option.aliases]) {
      const key = compact(name);
      const words = normalize(name).match(/[\p{L}\p{N}]+/gu) ?? [];
      if (key === query) score = Math.min(score, 0);
      else if (key.startsWith(query)) score = Math.min(score, 1);
      else if (words.some(word => word.startsWith(query))) score = Math.min(score, 2);
      else if (key.includes(query)) score = Math.min(score, 3);
      else if (tolerance) {
        for (const part of [key, ...words]) {
          const distance = editDistance(query, part.slice(0, query.length));
          if (distance <= tolerance) score = Math.min(score, 4 + distance);
        }
      }
    }
    return { option, score };
  }).filter(result => Number.isFinite(result.score))
    .sort((left, right) => left.score - right.score)
    .map(result => result.option);
}

export function petCatalogLabel(value: string | null | undefined, type: 'species' | 'breed', species?: string) {
  if (!value) return '';
  if (language === 'ru') return value;
  const group = speciesCatalog.find(option =>
    [option.ru, ...option.aliases].some(name => compact(name) === compact(type === 'species' ? value : species ?? '')));
  const item = type === 'species' ? group : group?.breeds.find(option => compact(option.ru) === compact(value));
  return item ? catalogName(item) : value;
}
