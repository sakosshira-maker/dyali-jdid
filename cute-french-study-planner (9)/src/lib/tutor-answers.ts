// Local teaching references used by the virtual professor (browser and server).
import { DAILY_WORDS } from "./study-catalog";

const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const LESSONS = [
  { terms: ["subjonctif", "il faut que"], answer: "Le subjonctif exprime notamment la volonté, le doute, la nécessité ou un jugement. Après « il faut que », on emploie normalement le subjonctif : « Il faut que tu viennes ». Attention : son emploi dépend de la construction, pas seulement d'un mot isolé. Compare : « Je pense qu'il vient » / « Je ne pense pas qu'il vienne ». Exercice : transforme « Tu dois faire ce travail » avec « Il faut que… »." },
  { terms: ["participe", "accord avec avoir"], answer: "Avec « être », le participe passé s'accorde généralement avec le sujet : « Elles sont arrivées ». Avec « avoir », il s'accorde avec le COD seulement si ce COD le précède : « Les lettres que j'ai écrites », mais « J'ai écrit des lettres ». Les verbes pronominaux demandent une analyse particulière : « Elles se sont parlé » (parler à quelqu'un). Identifie toujours la fonction du complément avant d'accorder." },
  { terms: ["phonetique", "phonologie"], answer: "La phonétique décrit la réalisation physique des sons : articulation, propriétés acoustiques, perception. La phonologie étudie leur organisation et leur fonction distinctive dans une langue. Exemple : /p/ et /b/ distinguent « pain » et « bain ». Pour enseigner, un travail articulatoire peut donc servir une distinction phonologique pertinente." },
  { terms: ["dont", "pronom relatif"], answer: "Le pronom relatif relie une subordonnée à un antécédent. « Qui » est sujet ; « que » est COD ; « dont » remplace un complément introduit par « de » ; « où » renvoie généralement à un lieu ou un temps. Exemples : « Le livre que je lis », « Le livre dont je parle ». Reconstruis les deux phrases simples pour vérifier la fonction." },
  { terms: ["imparfait", "passe compose"], answer: "Dans un récit au passé, l'imparfait présente souvent un arrière-plan, une habitude ou un procès vu dans son déroulement. Le passé composé présente généralement un événement délimité ou accompli : « Il pleuvait quand elle est arrivée ». Ce choix dépend du point de vue, pas d'une règle mécanique « long / court »." },
  { terms: ["a ou a", "preposition", "homophone"], answer: "Pour distinguer « a » et « à », essaie de remplacer par « avait » : « Elle a un livre » → « Elle avait un livre ». Si cela ne fonctionne pas et qu'il s'agit de la préposition, écris « à » : « aller à Paris ». Pour « ou / où », « ou » présente une alternative (remplaçable par « ou bien »), « où » exprime notamment un lieu ou un moment." },
  { terms: ["quoique", "quoi que"], answer: "« Quoique » signifie « bien que » : « Quoiqu'il soit fatigué, il travaille ». « Quoi que » signifie « quelle que soit la chose que » : « Quoi que tu fasses, préviens-moi ». Dans ces constructions concessives, on emploie le subjonctif. Le test « bien que » aide à choisir la graphie." },
];

export function localTutorAnswer(question: string): { answer: string; source: string } {
  const q = normalize(question);
  const lesson = LESSONS.find((l) => l.terms.some((t) => q.includes(t)));
  const word = DAILY_WORDS.find((w) => q.includes(normalize(w.term)));
  const answer = lesson?.answer || (word
    ? `${word.term} : ${word.definition}\n\nExemple : ${word.example}\n\nÀ toi : invente un autre exemple et explique pourquoi il correspond à cette notion.`
    : "Ta question mérite une réponse contextualisée. Les repères locaux ne suffisent pas pour ce sujet : conserve-la dans la Zone des doutes et confronte-la à ton cours ou à ton enseignante. Tu peux déjà préciser la notion, citer la phrase qui pose problème et formuler ton hypothèse. Une connexion IA configurée permet des réponses plus larges ; je préfère signaler cette limite plutôt qu'inventer une règle.");
  return { answer, source: "Repères pédagogiques locaux" };
}
