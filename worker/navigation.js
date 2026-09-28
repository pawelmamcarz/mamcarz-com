// Route labels describe destinations, not additional biographical claims.
export const DESTINATIONS = Object.freeze([
  { match: /\b(?:aplikac\p{L}*|applications?|software|workflow)\b/iu, path: 'aplikacje-operacyjne/', pl: 'Aplikacje operacyjne', en: 'Operational applications' },
  { match: /\b(?:ariba|fieldglass)\b/iu, path: 'uslugi/wdrozenie-sap-ariba/', pl: 'Wdrożenie SAP Ariba', en: 'SAP Ariba implementation' },
  { match: /(?:zamówieni\p{L}* publiczn\p{L}*|public procurement)/iu, path: 'uslugi/doradztwo-zamowienia-publiczne/', pl: 'Zamówienia publiczne', en: 'Public procurement' },
  { match: /\b(?:lotnictw\p{L}*|lotnicz\p{L}*|aviation|flight)\b/iu, path: 'lotnictwo/', pl: 'Lotnictwo', en: 'Aviation' },
  { match: /\b(?:projekt\p{L}*|projects?|portfolio|realizac\p{L}*|wdrożeni\p{L}*)\b/iu, path: 'case-studies/', pl: 'Projekty', en: 'Projects' },
  { match: /\b(?:wystąp\p{L}*|warsztat\p{L}*|speaking|workshops?|talks?)\b/iu, path: 'wystapienia/', pl: 'Wystąpienia', en: 'Speaking' },
  { match: /\b(?:wiedz\p{L}*|materiał\p{L}*|insights?|resources?|model)\b/iu, path: 'wiedza/', pl: 'Wiedza', en: 'Insights' },
  { match: /\b(?:prywatno\p{L}*|privacy)\b/iu, path: 'prywatnosc/', pl: 'Prywatność', en: 'Privacy' },
  { match: /\b(?:doradztw\p{L}*|transformac\p{L}*|advisory|transformation|procurement)\b/iu, path: 'uslugi/transformacja-zakupow/', pl: 'Transformacja zakupów', en: 'Procurement transformation' }
]);

export const ALLOWED_URLS = new Set([
  'mailto:pawel@mamcarz.com', 'https://www.linkedin.com/in/pawelmamcarz/', 'https://linkedin.com/in/pawelmamcarz/',
  ...['', 'en/'].flatMap(prefix => [
    `https://mamcarz.com/${prefix}`, `https://mamcarz.com/${prefix}#about`, `https://mamcarz.com/${prefix}#contact`,
    ...DESTINATIONS.map(item => `https://mamcarz.com/${prefix}${item.path}`)
  ])
]);

export function navigationAnswer(content, language) {
  if (/(?:kontakt|skontakt|contact|e-?mail|napisać)/iu.test(content)) return {
    reply: language === 'en' ? 'You can write directly to Paweł.' : 'Możesz napisać bezpośrednio do Pawła.',
    links: [{ label: 'pawel@mamcarz.com', url: 'mailto:pawel@mamcarz.com' }]
  };
  const matches = DESTINATIONS.filter(item => item.match.test(content)).slice(0, 3);
  if (!matches.length) return null;
  return {
    reply: language === 'en' ? 'You can find the relevant information here:' : 'Informacje na ten temat znajdziesz tutaj:',
    links: matches.map(item => ({ label: item[language], url: `https://mamcarz.com/${language === 'en' ? 'en/' : ''}${item.path}` }))
  };
}

export function replyLinks(reply) {
  const values = reply.match(/(?:https?:\/\/|mailto:)[^\s<>"']+/giu) ?? [];
  return [...new Set(values.map(value => value.replace(/[),.;!?]+$/u, '')))]
    .filter(url => ALLOWED_URLS.has(url))
    .map(url => ({ url, label: url === 'mailto:pawel@mamcarz.com' ? 'pawel@mamcarz.com' : url }));
}
