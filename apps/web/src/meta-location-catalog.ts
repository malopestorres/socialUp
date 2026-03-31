export type MetaLocationSuggestion = {
  id: string;
  name: string;
  subtitle: string;
  type: "state";
};

const META_LOCATION_CATALOG: MetaLocationSuggestion[] = [
  { id: "104051382963953", name: "Acre", subtitle: "Estado · AC", type: "state" },
  { id: "112330155447035", name: "Alagoas", subtitle: "Estado · AL", type: "state" },
  { id: "111717325510255", name: "Amapá", subtitle: "Estado · AP", type: "state" },
  { id: "109852232374465", name: "Amazonas", subtitle: "Estado · AM", type: "state" },
  { id: "107671155928811", name: "Bahia", subtitle: "Estado · BA", type: "state" },
  { id: "108253139199341", name: "Ceará", subtitle: "Estado · CE", type: "state" },
  { id: "112461948770215", name: "Distrito Federal", subtitle: "Estado · DF", type: "state" },
  { id: "103126746392505", name: "Espírito Santo", subtitle: "Estado · ES", type: "state" },
  { id: "109673965715560", name: "Goiás", subtitle: "Estado · GO", type: "state" },
  { id: "105436662826131", name: "Maranhão", subtitle: "Estado · MA", type: "state" },
  { id: "110830722271816", name: "Mato Grosso", subtitle: "Estado · MT", type: "state" },
  { id: "111520638861616", name: "Mato Grosso do Sul", subtitle: "Estado · MS", type: "state" },
  { id: "105655032800532", name: "Minas Gerais", subtitle: "Estado · MG", type: "state" },
  { id: "109156689109040", name: "Pará", subtitle: "Estado · PA", type: "state" },
  { id: "108170065879308", name: "Paraíba", subtitle: "Estado · PB", type: "state" },
  { id: "111956554817454", name: "Paraná", subtitle: "Estado · PR", type: "state" },
  { id: "108103135889390", name: "Pernambuco", subtitle: "Estado · PE", type: "state" },
  { id: "108373752520698", name: "Piauí", subtitle: "Estado · PI", type: "state" },
  { id: "112461948770215", name: "Rio de Janeiro", subtitle: "Estado · RJ", type: "state" },
  { id: "103126746392505", name: "Rio Grande do Norte", subtitle: "Estado · RN", type: "state" },
  { id: "112041285474323", name: "Rio Grande do Sul", subtitle: "Estado · RS", type: "state" },
  { id: "109506692404094", name: "Rondônia", subtitle: "Estado · RO", type: "state" },
  { id: "114704381874288", name: "Roraima", subtitle: "Estado · RR", type: "state" },
  { id: "110036662351296", name: "Santa Catarina", subtitle: "Estado · SC", type: "state" },
  { id: "105655032800532", name: "São Paulo", subtitle: "Estado · SP", type: "state" },
  { id: "105316336173007", name: "Sergipe", subtitle: "Estado · SE", type: "state" },
  { id: "104041132968314", name: "Tocantins", subtitle: "Estado · TO", type: "state" },
];

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function searchLocalMetaLocationSuggestions(query: string, limit = 10): MetaLocationSuggestion[] {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length < 2) {
    return [];
  }

  const scored = META_LOCATION_CATALOG.map((entry) => {
    const haystack = normalizeSearchText(`${entry.name} ${entry.subtitle}`);
    if (!haystack.includes(normalizedQuery)) {
      return null;
    }

    const startsWith = normalizeSearchText(entry.name).startsWith(normalizedQuery) ? 0 : 1;
    return {
      entry,
      score: `${startsWith}:${entry.name.length.toString().padStart(4, "0")}:${entry.name}`,
    };
  }).filter((item): item is { entry: MetaLocationSuggestion; score: string } => Boolean(item));

  scored.sort((left, right) => left.score.localeCompare(right.score));

  return scored.slice(0, limit).map(({ entry }) => entry);
}
