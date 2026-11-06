import type { SanitizedHtml } from '@stash/ui';
import type { ItemDetail } from '../service';

/** Example data for the mock: invented texts, as in the design proposal. */

const HOUR = 3_600_000;

export const SEED_ACCOUNT = { email: 'maria@ejemplo.com', password: 'calabaza-asada-2026' };

export const SEED_CATEGORIES = [
  { id: 'cat-trabajo', name: 'Trabajo' },
  { id: 'cat-casa', name: 'Casa' },
  { id: 'cat-recetas', name: 'Recetas' },
  { id: 'cat-madrid', name: 'Madrid' },
  { id: 'cat-viajes', name: 'Viajes' },
];

// Static example strings written here, so they are safe as they are.
const paragraphs = (...texts: string[]) =>
  texts.map((text) => `<p>${text}</p>`).join('') as SanitizedHtml;

export function seedItems(now: number): ItemDetail[] {
  const at = (hoursAgo: number) => now - hoursAgo * HOUR;
  return [
    {
      id: 'item-via-verde',
      url: 'https://rutasenbici.net/via-verde-del-aceite-jaen-alcaudete',
      title: 'Vía Verde del Aceite: tramo de Jaén a Alcaudete en bici',
      source: 'web',
      origin: 'rutasenbici.net',
      priority: null,
      categoryId: null,
      tags: [],
      status: 'pending',
      savedAt: at(2),
      queued: false,
      thumbnail: { tone: 2 },
      content: {
        kind: 'article',
        meta: 'rutasenbici.net · 8 min',
        html: paragraphs(
          'El tramo entre Jaén y Alcaudete sigue el antiguo trazado del tren del aceite: 55 kilómetros casi llanos entre olivares, con túneles iluminados y viaductos de hierro.',
          'Conviene salir temprano en verano. Hay fuentes en las antiguas estaciones de Torredonjimeno y Martos, y el firme es bueno salvo un tramo corto de grava.',
        ),
      },
    },
    {
      id: 'item-despensa',
      url: 'https://lacocinaordenada.es/organizar-la-despensa',
      title: 'Cómo organizar la despensa para no tirar comida',
      source: 'web',
      origin: 'lacocinaordenada.es',
      priority: 'high',
      categoryId: 'cat-casa',
      tags: ['despensa'],
      status: 'pending',
      savedAt: at(20),
      queued: false,
      thumbnail: { tone: 1 },
      content: {
        kind: 'article',
        meta: 'lacocinaordenada.es · 6 min',
        html: paragraphs(
          'Lo primero es sacar todo y mirar fechas. Lo que caduca antes va delante y a la altura de los ojos; lo que dura meses, arriba o al fondo.',
          'Después, agrupa por uso y no por tipo: lo del desayuno junto, lo de cenar rápido junto. Así ves de un vistazo qué falta antes de ir a comprar.',
          'Una vez al mes, revisa lo de atrás.',
        ),
      },
    },
    {
      id: 'item-abono',
      url: 'https://www.reddit.com/r/askspain/comments/1g7abcd/compensa_el_abono_anual',
      title: '¿Compensa el abono transporte anual si teletrabajo dos días?',
      source: 'reddit',
      origin: 'r/askspain',
      priority: 'high',
      categoryId: 'cat-madrid',
      tags: [],
      status: 'pending',
      savedAt: at(30),
      queued: false,
      thumbnail: { tone: 3 },
      content: {
        kind: 'reddit',
        meta: 'r/askspain · u/carmen_rv',
        html: paragraphs(
          'Voy a la oficina tres días por semana y en agosto casi nada. Con el mensual pago todos los meses lo mismo aunque no lo use.',
          '¿Alguien ha hecho la cuenta? Me interesa sobre todo si el anual se puede pausar en vacaciones.',
        ),
      },
    },
    {
      id: 'item-vscode',
      url: 'https://x.com/martagil_dev/status/1846000000000000000',
      title: 'Los atajos de VS Code que más uso al revisar código',
      source: 'x',
      origin: '@martagil_dev',
      priority: 'medium',
      categoryId: 'cat-trabajo',
      tags: ['atajos'],
      status: 'pending',
      savedAt: at(26),
      queued: false,
      thumbnail: { tone: 3 },
      content: {
        kind: 'tweet',
        author: { name: 'Marta Gil', handle: '@martagil_dev' },
        html: paragraphs(
          'Los atajos de VS Code que más uso al revisar código: Alt+clic para varios cursores, Ctrl+P para saltar a un archivo y F8 para ir al siguiente error. Debajo, una captura con el resto.',
        ),
        images: [],
        date: '14 oct. 2026, 18:02',
      },
    },
    {
      id: 'item-calabaza',
      url: 'https://www.instagram.com/p/DAbCdEfGhIj/',
      title: 'Crema de calabaza asada con comino y yogur',
      source: 'instagram',
      origin: '@verduradetemporada',
      priority: 'medium',
      categoryId: 'cat-recetas',
      tags: ['otoño', 'cena'],
      status: 'pending',
      savedAt: at(4),
      queued: false,
      thumbnail: { tone: 4 },
      content: {
        kind: 'preview',
        description: 'Crema de calabaza asada con comino y yogur. Receta para cuatro…',
        blocked: false,
      },
    },
    {
      id: 'item-madrid-2027',
      url: 'https://www.reddit.com/r/Madrid/comments/1g9efgh/cambios_en_el_transporte_2027',
      title: 'Cambios en el transporte de Madrid para 2027',
      source: 'reddit',
      origin: 'r/Madrid',
      priority: 'medium',
      categoryId: 'cat-madrid',
      tags: [],
      status: 'pending',
      savedAt: at(50),
      queued: false,
      thumbnail: { tone: 3 },
      content: {
        kind: 'reddit',
        meta: 'r/Madrid · u/luis_cercanias',
        html: paragraphs(
          'Resumen de lo que ha salido en el pleno: el abono joven se mantiene y el anual pasa a poder pausarse un mes al año.',
          'Las líneas nocturnas amplían horario los viernes.',
        ),
      },
    },
    {
      id: 'item-gran-via',
      url: 'https://www.reddit.com/r/Madrid/comments/1g2ijkl/fotos_antiguas_gran_via',
      title: 'Fotos antiguas de Madrid: la Gran Vía en obras',
      source: 'reddit',
      origin: 'r/Madrid',
      priority: 'low',
      categoryId: 'cat-madrid',
      tags: [],
      status: 'pending',
      savedAt: at(70),
      queued: false,
      thumbnail: { tone: 2 },
      content: {
        kind: 'reddit',
        meta: 'r/Madrid · u/archivo_matritense',
        html: paragraphs(
          'Encontré estas fotos en casa de mi abuela: la Gran Vía a medio construir, con el edificio Telefónica todavía en andamios.',
        ),
      },
    },
    {
      id: 'item-extensiones',
      url: 'https://x.com/martagil_dev/status/1849000000000000000',
      title: 'Hilo con las extensiones que tengo instaladas y por qué quité la mitad',
      source: 'x',
      origin: '@martagil_dev',
      priority: 'low',
      categoryId: 'cat-trabajo',
      tags: [],
      status: 'pending',
      savedAt: at(90),
      queued: false,
      thumbnail: { tone: 1 },
      content: {
        kind: 'preview',
        description: '«Hilo con las extensiones que tengo instaladas y por qué quité la mitad…»',
        blocked: true,
      },
    },
    {
      id: 'item-pan',
      url: 'https://lacocinaordenada.es/pan-de-masa-madre-sin-amasar',
      title: 'Pan de masa madre sin amasar, paso a paso',
      source: 'web',
      origin: 'lacocinaordenada.es',
      priority: 'low',
      categoryId: 'cat-recetas',
      tags: ['cena'],
      status: 'read',
      savedAt: at(200),
      queued: false,
      thumbnail: { tone: 4 },
      content: {
        kind: 'article',
        meta: 'lacocinaordenada.es · 5 min',
        html: paragraphs('Mezcla, espera doce horas, pliega dos veces y al horno en olla.'),
      },
    },
    {
      id: 'item-cola',
      url: 'https://www.reddit.com/r/Madrid/comments/1h2kmnop/mercadillos_de_navidad',
      title: 'reddit.com/r/Madrid/comments/1h2kmnop/mercadillos_de_navidad',
      source: 'reddit',
      origin: 'r/Madrid',
      priority: null,
      categoryId: null,
      tags: [],
      status: 'pending',
      savedAt: at(0.5),
      queued: true,
      thumbnail: { tone: 2 },
      content: { kind: 'none' },
    },
  ];
}
