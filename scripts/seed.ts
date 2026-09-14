/**
 * Carga el banco curado: voces, intenciones y las pistas de música que
 * encuentre en assets/music. Es idempotente — se puede correr las veces que
 * haga falta sin duplicar nada.
 *
 *   npm run seed
 */
import "./_bootstrap";
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { log, requireEnv, fatal } from "./_bootstrap";
import { db } from "../src/lib/supabase";
import { ensureBucket, uploadAudio } from "../src/lib/storage";
import { durationOf } from "../src/lib/generation/audio";

const MUSIC_DIR = "assets/music";
const AUDIO_EXTENSIONS = [".mp3", ".m4a", ".wav"];

/**
 * El español va en las columnas base; `i18n` lleva el resto de los idiomas.
 * El nombre no se traduce: es un nombre propio.
 */
const VOICES = [
  { slug: "aurora", name: "Aurora", accent: "Español neutro", gender: "Femenina", tone: "Media", languages: ["es", "en"],
    blurb: "Pausada y templada. Funciona bien para sesiones largas y para dormir.",
    i18n: { en: { accent: "Neutral Spanish", blurb: "Unhurried and even. Works well for long sessions and for falling asleep." } } },
  { slug: "mateo", name: "Mateo", accent: "Español rioplatense", gender: "Masculina", tone: "Grave", languages: ["es"],
    blurb: "Cercano, con silencios largos. El acento se nota y a mucha gente le acomoda.",
    i18n: { en: { accent: "Rioplatense Spanish", blurb: "Close up, with long silences. The accent is noticeable and plenty of people find it comfortable." } } },
  { slug: "lucia", name: "Lucía", accent: "Español de España", gender: "Femenina", tone: "Aguda", languages: ["es"],
    blurb: "Clara y despierta. Buena para enfoque y para meditaciones de cinco minutos.",
    i18n: { en: { accent: "Spanish from Spain", blurb: "Clear and awake. Good for focus and for five-minute meditations." } } },
  { slug: "tomas", name: "Tomás", accent: "Español chileno", gender: "Masculina", tone: "Media", languages: ["es"],
    blurb: "Directo, sin solemnidad. Para quien encuentra artificial el tono de meditación.",
    i18n: { en: { accent: "Chilean Spanish", blurb: "Direct, with no solemnity. For anyone who finds the usual meditation tone artificial." } } },
  { slug: "nora", name: "Nora", accent: "Inglés británico", gender: "Femenina", tone: "Grave", languages: ["en"],
    blurb: "Grave y contenida. La más pedida en las sesiones en inglés.",
    i18n: { en: { accent: "British English", blurb: "Deep and restrained. The most requested voice in the English sessions." } } },
  { slug: "elias", name: "Elías", accent: "Español mexicano", gender: "Masculina", tone: "Grave", languages: ["es", "en"],
    blurb: "Cálido y amplio. Sostiene bien los tramos de respiración.",
    i18n: { en: { accent: "Mexican Spanish", blurb: "Warm and roomy. Holds the breathing passages well." } } },
  { slug: "ines", name: "Inês", accent: "Portugués de Brasil", gender: "Femenina", tone: "Media", languages: ["pt"],
    blurb: "Suave y con ritmo. Recién incorporada al banco.",
    i18n: { en: { accent: "Brazilian Portuguese", blurb: "Soft and rhythmic. Just added to the bank." } } },
  { slug: "ruben", name: "Ruben", accent: "Inglés estadounidense", gender: "Masculina", tone: "Media", languages: ["en"],
    blurb: "Neutro y estable. La opción segura si no sabes por dónde empezar.",
    i18n: { en: { accent: "American English", blurb: "Neutral and steady. The safe pick if you do not know where to start." } } },
];

/**
 * El banco cubre una misma necesidad en distintas áreas de la vida, porque
 * "no logro dormir" no se trabaja igual si lo que no se apaga es el trabajo,
 * la plata o una pelea de anoche. `category` es el área (trabajo, dinero,
 * salud, relaciones, comunidad y la práctica sin área) y `tag` es la
 * necesidad; la portada filtra por lo primero y muestra lo segundo.
 *
 * `summary` sí se muestra: es la frase en la que la persona se reconoce, y
 * suele ser lo que decide el clic más que el título.
 *
 * `brief` no se muestra: es lo que lee el modelo al escribir la plantilla. Se
 * traduce igual, porque la plantilla en inglés se escribe mejor desde un brief
 * en inglés que desde uno en español.
 */
const INTENTIONS = [
  /* ───────────────────────────── trabajo ───────────────────────────── */
  { slug: "dormir-con-el-trabajo-en-la-cabeza", title: "Dormir con el trabajo en la cabeza", tag: "Dormir", category: "trabajo", durations: [10, 20],
    summary: "Se acabó el día pero la cabeza sigue en la reunión de mañana.",
    brief: "Preparar el sueño cuando lo que mantiene despierta a la persona es el trabajo. No resolver nada laboral: dejarlo anotado en algún lugar mental y bajar el ritmo. Frases cada vez más cortas, sin despedida.",
    i18n: { en: {
      title: "Sleeping with work still in your head", tag: "Sleep",
      summary: "The day is over but your head is still in tomorrow's meeting.",
      brief: "Prepare for sleep when what keeps the person awake is work. Solve nothing work-related: leave it noted somewhere mental and slow the pace down. Sentences getting shorter, no goodbye." } } },
  { slug: "ansiedad-antes-de-una-reunion", title: "Ansiedad antes de una reunión", tag: "Ansiedad", category: "trabajo", durations: [5, 10],
    summary: "Pecho apretado y aceleración antes de exponer o de pedir algo.",
    brief: "Bajar la activación previa a una situación de exposición laboral. Respiración larga, contacto con el peso del cuerpo y una imagen de la persona hablando sin apuro. Sin promesas sobre el resultado.",
    i18n: { en: {
      title: "Anxious before a meeting", tag: "Anxiety",
      summary: "Tight chest and a racing body before presenting or asking for something.",
      brief: "Bring down activation ahead of an exposing work situation. Long breathing, contact with the weight of the body, and an image of the person speaking unhurried. No promises about the outcome." } } },
  { slug: "enfocarme-en-una-sola-tarea", title: "Enfocarme en una sola tarea", tag: "Foco", category: "trabajo", durations: [5, 10],
    summary: "No logras sostener nada más de diez minutos.",
    brief: "Estrechar la atención a una sola tarea. Despierta y breve; termina con la persona lista para abrir el trabajo, no relajada hasta dormirse. Nombrar la tarea y el primer movimiento concreto.",
    i18n: { en: {
      title: "Focusing on one single task", tag: "Focus",
      summary: "You cannot hold anything for more than ten minutes.",
      brief: "Narrow attention down to one task. Awake and brief; end with the person ready to open their work, not relaxed to the point of sleep. Name the task and the first concrete move." } } },
  { slug: "soltar-la-tension-de-la-jornada", title: "Soltar la tensión de la jornada", tag: "Cuerpo", category: "trabajo", durations: [10, 15],
    summary: "Cuello, mandíbula y hombros después de horas en la silla.",
    brief: "Recorrido corporal orientado a las zonas que carga el trabajo de escritorio: mandíbula, cuello, hombros, manos. Exhalación larga. Ninguna indicación médica ni de ejercicios.",
    i18n: { en: {
      title: "Letting the workday out of the body", tag: "Body",
      summary: "Neck, jaw and shoulders after hours in the chair.",
      brief: "Body scan aimed at the areas desk work loads up: jaw, neck, shoulders, hands. Long exhale. No medical or exercise instructions." } } },
  { slug: "rabia-despues-de-un-comentario", title: "Rabia después de un comentario", tag: "Emoción", category: "trabajo", durations: [10, 15],
    summary: "Un mensaje o una devolución que quedó dando vueltas.",
    brief: "Sostener rabia laboral sin actuarla y sin negarla. Nombrarla, ubicarla en el cuerpo, distinguir el hecho de la interpretación. No pedir perdón ni obligar a perdonar.",
    i18n: { en: {
      title: "Angry after something someone said", tag: "Emotion",
      summary: "A message or a piece of feedback that keeps going round.",
      brief: "Hold work anger without acting on it and without denying it. Name it, locate it in the body, separate the fact from the interpretation. Do not ask for or demand forgiveness." } } },
  { slug: "para-que-estoy-haciendo-esto", title: "¿Para qué estoy haciendo esto?", tag: "Sentido", category: "trabajo", durations: [15, 20],
    summary: "Cumples con todo y ya no sabes para qué.",
    brief: "Revisar el sentido del propio trabajo sin decidir nada. Mirar qué se sostiene con él y qué se dejó de ver. Sin consejos de carrera ni empuje a renunciar.",
    i18n: { en: {
      title: "What am I doing all this for?", tag: "Meaning",
      summary: "You deliver everything and no longer know what for.",
      brief: "Review the meaning of one's work without deciding anything. Look at what it holds up and what stopped being visible. No career advice, no push to quit." } } },

  /* ───────────────────────────── dinero ───────────────────────────── */
  { slug: "dormir-con-las-cuentas-en-la-cabeza", title: "Dormir con las cuentas en la cabeza", tag: "Dormir", category: "dinero", durations: [10, 20],
    summary: "Los números aparecen justo cuando apagas la luz.",
    brief: "Preparar el sueño interrumpido por preocupación económica. No hacer cálculos ni planes: reconocer la preocupación, dejarla con un lugar y una hora para mañana, y bajar la activación. Ningún consejo financiero.",
    i18n: { en: {
      title: "Sleeping with the bills in your head", tag: "Sleep",
      summary: "The numbers show up right as you turn off the light.",
      brief: "Prepare for sleep interrupted by money worry. No calculations or plans: acknowledge the worry, give it a place and a time tomorrow, and bring activation down. No financial advice." } } },
  { slug: "ansiedad-a-fin-de-mes", title: "Ansiedad a fin de mes", tag: "Ansiedad", category: "dinero", durations: [5, 10],
    summary: "Se aprieta el pecho cada vez que miras el saldo.",
    brief: "Bajar la activación ante la estrechez económica. Respiración y cuerpo; validar el miedo sin minimizarlo y sin prometer que se va a resolver. Nada de abundancia ni de atraer dinero.",
    i18n: { en: {
      title: "Anxious at the end of the month", tag: "Anxiety",
      summary: "Your chest tightens every time you check the balance.",
      brief: "Bring down activation in the face of money pressure. Breathing and body; validate the fear without minimising it and without promising it will be resolved. No abundance or manifesting talk." } } },
  { slug: "sentarme-a-mirar-mis-cuentas", title: "Sentarme a mirar mis cuentas", tag: "Foco", category: "dinero", durations: [5, 10],
    summary: "Lo postergas hace semanas y hoy quieres abrirlas.",
    brief: "Preparar a la persona para una tarea que viene evitando. Tolerancia a la incomodidad, atención estrecha, un solo paso: abrir y mirar. Sin juicio sobre decisiones pasadas y sin consejo financiero.",
    i18n: { en: {
      title: "Sitting down to look at my finances", tag: "Focus",
      summary: "You have put it off for weeks and today you want to open it.",
      brief: "Prepare the person for a task they have been avoiding. Tolerance for discomfort, narrow attention, a single step: open it and look. No judgement about past decisions and no financial advice." } } },
  { slug: "culpa-por-como-gasto", title: "Culpa por cómo gasto", tag: "Emoción", category: "dinero", durations: [10, 15],
    summary: "Compraste algo y llevas horas castigándote.",
    brief: "Trabajar culpa y vergüenza en torno al dinero. Separar la conducta de la identidad, bajar la autocrítica, sin justificar el gasto ni arrancar promesas de cambio.",
    i18n: { en: {
      title: "Guilt about how I spend", tag: "Emotion",
      summary: "You bought something and you have spent hours punishing yourself.",
      brief: "Work with guilt and shame around money. Separate the behaviour from the identity, bring self-criticism down, without justifying the spending or extracting promises to change." } } },
  { slug: "hablar-de-plata-sin-pelear", title: "Hablar de plata sin pelear", tag: "Vínculo", category: "dinero", durations: [15, 20],
    summary: "Antes de la conversación de dinero que se viene postergando.",
    brief: "Preparar una conversación económica con alguien cercano. Reconocer la propia parte, aceptar que la otra persona tiene su versión, sostener el pedido sin ataque. Sin guion de negociación.",
    i18n: { en: {
      title: "Talking money without a fight", tag: "Connection",
      summary: "Before the money conversation that keeps getting postponed.",
      brief: "Prepare a money conversation with someone close. Acknowledge one's own part, accept that the other person has their version, hold the request without attacking. No negotiation script." } } },
  { slug: "dejar-de-compararme", title: "Dejar de compararme", tag: "Emoción", category: "dinero", durations: [5, 10],
    summary: "Miras lo que tienen otros y lo tuyo se achica.",
    brief: "Bajar la comparación económica. Volver a lo concreto y propio, sin moralizar sobre el dinero ajeno ni consolar con frases de agradecimiento forzado.",
    i18n: { en: {
      title: "Letting go of comparing myself", tag: "Emotion",
      summary: "You look at what others have and yours shrinks.",
      brief: "Bring money comparison down. Return to what is concrete and one's own, without moralising about other people's money or consoling with forced gratitude." } } },

  /* ───────────────────────────── salud ───────────────────────────── */
  { slug: "dormir-con-el-cuerpo-molesto", title: "Dormir con el cuerpo molesto", tag: "Dormir", category: "salud", durations: [10, 20],
    summary: "Dolor, incomodidad o un cuerpo que no encuentra postura.",
    brief: "Preparar el sueño con molestia física presente. No prometer que el dolor se va: bajar la resistencia a la molestia, ampliar la atención al resto del cuerpo, ritmo muy lento. Ninguna indicación médica.",
    i18n: { en: {
      title: "Sleeping with an uncomfortable body", tag: "Sleep",
      summary: "Pain, discomfort, or a body that cannot find a position.",
      brief: "Prepare for sleep with physical discomfort present. Do not promise the pain will go: lower the resistance to the discomfort, widen attention to the rest of the body, very slow pace. No medical instructions." } } },
  { slug: "esperar-un-resultado-medico", title: "Esperar un resultado médico", tag: "Ansiedad", category: "salud", durations: [10, 15],
    summary: "Entre el examen y la noticia no puedes con nada.",
    brief: "Sostener la incertidumbre de una espera médica. No anticipar escenarios ni tranquilizar con certezas falsas: respiración, presente, tolerar el no saber. Sin ningún contenido clínico.",
    i18n: { en: {
      title: "Waiting for a medical result", tag: "Anxiety",
      summary: "Between the test and the news you can't handle anything.",
      brief: "Hold the uncertainty of a medical wait. Do not anticipate scenarios or reassure with false certainty: breathing, the present, tolerating not knowing. No clinical content whatsoever." } } },
  { slug: "aflojar-el-cuerpo-contracturado", title: "Aflojar el cuerpo contracturado", tag: "Cuerpo", category: "salud", durations: [10, 15],
    summary: "Andas duro, cansado, con todo apretado.",
    brief: "Distensión corporal general. Recorrido lento con exhalación larga, sin pedir estiramientos ni movimientos. Nada de diagnóstico ni de explicación fisiológica.",
    i18n: { en: {
      title: "Loosening a body that is all knots", tag: "Body",
      summary: "You are stiff, tired, clenched everywhere.",
      brief: "General bodily release. Slow scan with long exhale, without asking for stretches or movement. No diagnosis or physiological explanation." } } },
  { slug: "sostener-el-habito-que-empece", title: "Sostener el hábito que empecé", tag: "Hábito", category: "salud", durations: [10, 15],
    summary: "Ya pasó la motivación de la primera semana.",
    brief: "Sostener una conducta de salud en el tiempo. Nada de metas de peso ni de apariencia, ninguna indicación médica ni nutricional: solo la relación con el hábito y el día siguiente.",
    i18n: { en: {
      title: "Keeping up the habit I started", tag: "Habit",
      summary: "The first week's motivation has worn off.",
      brief: "Sustain a health behaviour over time. No weight or appearance goals, no medical or nutritional advice: only the relationship with the habit and the next day." } } },
  { slug: "hacer-las-paces-con-mi-cuerpo", title: "Hacer las paces con mi cuerpo", tag: "Emoción", category: "salud", durations: [10, 15],
    summary: "Estás peleado con el cuerpo que tienes hoy.",
    brief: "Bajar la hostilidad hacia el propio cuerpo. Reconocimiento concreto de lo que el cuerpo hace, no de cómo se ve. Sin metas estéticas ni promesas de cambio.",
    i18n: { en: {
      title: "Making peace with my body", tag: "Emotion",
      summary: "You are at war with the body you have today.",
      brief: "Bring down hostility towards one's own body. Concrete recognition of what the body does, not how it looks. No aesthetic goals or promises of change." } } },

  /* ───────────────────────────── relaciones ───────────────────────────── */
  { slug: "dormir-despues-de-una-pelea", title: "Dormir después de una pelea", tag: "Dormir", category: "relaciones", durations: [10, 20],
    summary: "Te acostaste con la discusión todavía abierta.",
    brief: "Preparar el sueño después de un conflicto cercano. No resolver el conflicto ni ensayar respuestas: dejar la conversación para mañana, soltar la mandíbula, bajar la activación.",
    i18n: { en: {
      title: "Sleeping after a fight", tag: "Sleep",
      summary: "You went to bed with the argument still open.",
      brief: "Prepare for sleep after a close conflict. Do not resolve the conflict or rehearse replies: leave the conversation for tomorrow, release the jaw, bring activation down." } } },
  { slug: "estoy-seco-con-los-mios", title: "Estoy seco con los míos", tag: "Vínculo", category: "relaciones", durations: [10, 15],
    summary: "Estás con la gente que quieres y no llega nada.",
    brief: "Recuperar contacto afectivo cuando hay embotamiento. Sin culpa por la distancia: traer a alguien concreto a la mente, notar qué aparece en el cuerpo, terminar con un gesto pequeño y posible.",
    i18n: { en: {
      title: "I've gone numb with the people I love", tag: "Connection",
      summary: "You are with the people you love and nothing comes through.",
      brief: "Recover affective contact when there is numbness. No guilt about the distance: bring one specific person to mind, notice what appears in the body, end with one small, possible gesture." } } },
  { slug: "antes-de-una-conversacion-dificil", title: "Antes de una conversación difícil", tag: "Vínculo", category: "relaciones", durations: [15, 20],
    summary: "La que vienes postergando hace semanas.",
    brief: "Preparar un vínculo tensionado. Reconocer la propia parte sin culpa, sostener que la otra persona tiene su versión, sin prometer reconciliación.",
    i18n: { en: {
      title: "Before a difficult conversation", tag: "Connection",
      summary: "The one you have been putting off for weeks.",
      brief: "Prepare for a strained relationship. Acknowledge one's own part without guilt, hold that the other person has their version, without promising reconciliation." } } },
  { slug: "rabia-con-alguien-que-quiero", title: "Rabia con alguien que quiero", tag: "Emoción", category: "relaciones", durations: [10, 15],
    summary: "Estás con rabia y además con culpa por tenerla.",
    brief: "Sostener rabia hacia alguien cercano sin actuarla. Nombrarla, ubicarla en el cuerpo, separar el hecho de la historia que se armó encima. No obligar a perdonar.",
    i18n: { en: {
      title: "Angry at someone I love", tag: "Emotion",
      summary: "You are angry, and also guilty for being angry.",
      brief: "Hold anger towards someone close without acting on it. Name it, locate it in the body, separate the fact from the story built on top. Do not demand forgiveness." } } },
  { slug: "pena-por-una-distancia", title: "Pena por una distancia", tag: "Emoción", category: "relaciones", durations: [15, 20],
    summary: "Una ruptura, un alejamiento, alguien que ya no está cerca.",
    brief: "Acompañar la pena por la pérdida de un vínculo. Dejar que la tristeza esté, sin apurar el duelo ni proponer aprendizajes. Cuerpo, respiración y compañía.",
    i18n: { en: {
      title: "Grief over a distance", tag: "Emotion",
      summary: "A breakup, a drifting apart, someone who is no longer close.",
      brief: "Accompany grief over the loss of a relationship. Let the sadness be there, without rushing it or offering lessons. Body, breathing and company." } } },
  { slug: "escuchar-sin-reaccionar", title: "Escuchar sin reaccionar", tag: "Foco", category: "relaciones", durations: [5, 10],
    summary: "Quieres llegar a la conversación sin saltar al primer roce.",
    brief: "Preparar la escucha. Atención sostenida en la otra persona, notar el impulso de responder y dejarlo pasar. Breve y despierta, no relajante.",
    i18n: { en: {
      title: "Listening without reacting", tag: "Focus",
      summary: "You want to get to the conversation without jumping at the first friction.",
      brief: "Prepare for listening. Sustained attention on the other person, noticing the urge to reply and letting it pass. Brief and awake, not relaxing." } } },

  /* ───────────────────────────── comunidad ───────────────────────────── */
  { slug: "ansiedad-antes-de-ver-gente", title: "Ansiedad antes de ver gente", tag: "Ansiedad", category: "comunidad", durations: [5, 10],
    summary: "Una junta, una reunión, un grupo donde no conoces a nadie.",
    brief: "Ansiedad social previa. Respiración y cuerpo; bajar la anticipación del juicio ajeno sin prometer que va a salir bien. Sin técnicas sociales ni consejos de conversación.",
    i18n: { en: {
      title: "Anxious before seeing people", tag: "Anxiety",
      summary: "A gathering, a meeting, a group where you know no one.",
      brief: "Pre-social anxiety. Breathing and body; lower the anticipation of other people's judgement without promising it will go well. No social techniques or conversation tips." } } },
  { slug: "dormir-despues-de-un-dia-con-mucha-gente", title: "Dormir después de un día con mucha gente", tag: "Dormir", category: "comunidad", durations: [10, 20],
    summary: "Vienes sobrecargado de tanto contacto y no logras bajar.",
    brief: "Preparar el sueño tras sobreestimulación social. Descargar el ruido del día sin repasar conversaciones, ritmo muy lento, atención a lo que no requiere responder a nadie.",
    i18n: { en: {
      title: "Sleeping after a day full of people", tag: "Sleep",
      summary: "You come home overloaded from so much contact and cannot come down.",
      brief: "Prepare for sleep after social overstimulation. Discharge the day's noise without replaying conversations, very slow pace, attention on what asks nothing back." } } },
  { slug: "impotencia-con-las-noticias", title: "Impotencia con las noticias", tag: "Emoción", category: "comunidad", durations: [10, 15],
    summary: "Rabia y cansancio con lo que pasa y no controlas.",
    brief: "Sostener la impotencia frente a lo colectivo. Nombrar la rabia y la pena, devolver la atención al radio de acción propio. Sin posición política ni consuelo fácil.",
    i18n: { en: {
      title: "Powerless in front of the news", tag: "Emotion",
      summary: "Anger and exhaustion at what is happening and you cannot control.",
      brief: "Hold powerlessness in the face of collective events. Name the anger and the grief, return attention to one's own radius of action. No political position, no easy consolation." } } },
  { slug: "cansancio-de-cuidar-a-otros", title: "Cansancio de cuidar a otros", tag: "Cuerpo", category: "comunidad", durations: [10, 20],
    summary: "Llevas mucho rato sosteniendo a alguien más.",
    brief: "Descarga para quien cuida. Descanso sin culpa, recorrido corporal, permiso explícito para no estar disponible durante la sesión. Sin indicaciones sobre el cuidado mismo.",
    i18n: { en: {
      title: "Worn out from caring for others", tag: "Body",
      summary: "You have been holding someone else up for a long time.",
      brief: "Release for the person who cares for others. Rest without guilt, body scan, explicit permission to be unavailable for the length of the session. No instructions about the caregiving itself." } } },
  { slug: "aportar-algo-mas-alla-de-mi", title: "Aportar algo más allá de mí", tag: "Sentido", category: "comunidad", durations: [15, 20],
    summary: "Quieres que lo tuyo sirva para algo más grande.",
    brief: "Explorar el sentido de contribución sin grandilocuencia. Lo concreto y cercano: quién está al lado, qué está en las manos de la persona esta semana. Nada épico ni místico.",
    i18n: { en: {
      title: "Contributing something beyond me", tag: "Meaning",
      summary: "You want what you do to serve something larger.",
      brief: "Explore the meaning of contribution without grandiosity. What is concrete and close: who is nearby, what is in the person's hands this week. Nothing epic or mystical." } } },
  { slug: "llegar-presente-a-un-compromiso", title: "Llegar presente a un compromiso", tag: "Foco", category: "comunidad", durations: [5, 10],
    summary: "Un voluntariado, una reunión de vecinos, algo que dijiste que ibas a hacer.",
    brief: "Entrar despierta a una actividad con otros. Atención abierta, cuerpo asentado, sin urgencia. Termina lista para participar, no relajada.",
    i18n: { en: {
      title: "Arriving present at a commitment", tag: "Focus",
      summary: "A volunteer shift, a neighbours' meeting, something you said you would do.",
      brief: "Enter an activity with others while awake. Open attention, settled body, no urgency. End ready to take part, not relaxed." } } },

  /* ───────────────────────────── práctica ───────────────────────────── */
  { slug: "practicar-sin-objetivo", title: "Practicar sin objetivo", tag: "Sin objetivo", category: "practica", durations: [10, 15, 20],
    summary: "Sentarte un rato sin querer arreglar nada.",
    brief: "Práctica abierta, sin meta ni resultado. Respiración y atención a lo que aparece; no dirigir hacia la calma, el foco ni el sueño.",
    i18n: { en: {
      title: "Practising with no goal", tag: "No goal",
      summary: "Sitting for a while without trying to fix anything.",
      brief: "Open practice, no goal or outcome. Breathing and attention to whatever appears; do not steer towards calm, focus or sleep." } } },
  { slug: "cinco-minutos-y-volver", title: "Cinco minutos y volver", tag: "Sin objetivo", category: "practica", durations: [5],
    summary: "Una pausa corta en medio del día.",
    brief: "Pausa breve en mitad del día. Entrar, respirar, salir despierta. Sin trabajo emocional ni profundidad.",
    i18n: { en: {
      title: "Five minutes and back", tag: "No goal",
      summary: "A short pause in the middle of the day.",
      brief: "Brief pause in the middle of the day. Come in, breathe, leave awake. No emotional work, no depth." } } },
  { slug: "soltar-el-dia", title: "Soltar el día", tag: "Dormir", category: "practica", durations: [5, 10],
    summary: "Cerrar la jornada sin arrastrarla a la noche.",
    brief: "Cerrar el día. Repasar sin juicio, dejar lo pendiente anotado en algún lugar mental y bajar la activación.",
    i18n: { en: {
      title: "Let the day go", tag: "Sleep",
      summary: "Close the day without dragging it into the night.",
      brief: "Close the day. Review without judgement, leave what is pending noted somewhere mental, and bring activation down." } } },
  { slug: "gratitud-por-la-manana", title: "Gratitud por la mañana", tag: "Sentido", category: "practica", durations: [5],
    summary: "Cinco minutos para empezar el día en otro registro.",
    brief: "Gratitud concreta y cotidiana, nada abstracto ni cósmico. Cosas pequeñas y cercanas.",
    i18n: { en: {
      title: "Morning gratitude", tag: "Meaning",
      summary: "Five minutes to start the day in a different register.",
      brief: "Concrete, everyday gratitude, nothing abstract or cosmic. Small, close-at-hand things." } } },
];


/**
 * Ejercicios de respiración.
 *
 * No son texto: son una grilla de tiempo. `phases` define un ciclo y el resto
 * lo calcula `src/lib/breathing.ts` según el hueco que le dé la sesión. El
 * audio no se genera acá — se pregenera con `npm run respiracion`, que es lo
 * que permite verificarlo antes de que lo escuche nadie.
 */
const BREATHING = [
  {
    slug: "4-7-8",
    name: "4-7-8",
    summary: "Inhalas cuatro, sostienes siete y sueltas ocho. La exhalación larga es la que baja la activación.",
    phases: [
      { kind: "inhale", seconds: 4 },
      { kind: "hold", seconds: 7 },
      { kind: "exhale", seconds: 8 },
    ],
    min_cycles: 2,
    max_cycles: 6,
    counting: "last",
    breath_sounds: true,
    lead_in_seconds: 12,
    gap_seconds: 4,
    tail_seconds: 8,
    i18n: {
      en: {
        summary: "Breathe in for four, hold for seven, let go for eight. The long exhale is what brings the activation down.",
      },
    },
  },
  {
    slug: "caja-4-4-4-4",
    name: "Caja 4-4-4-4",
    summary: "Cuatro tiempos iguales, con los pulmones llenos y vacíos. Simétrico y fácil de seguir la primera vez.",
    phases: [
      { kind: "inhale", seconds: 4 },
      { kind: "hold", seconds: 4 },
      { kind: "exhale", seconds: 4 },
      { kind: "empty", seconds: 4 },
    ],
    min_cycles: 2,
    max_cycles: 8,
    counting: "last",
    breath_sounds: true,
    lead_in_seconds: 13,
    gap_seconds: 4,
    tail_seconds: 8,
    i18n: {
      en: {
        name: "Box 4-4-4-4",
        summary: "Four equal counts, lungs full and lungs empty. Symmetrical and easy to follow the first time.",
      },
    },
  },
  {
    slug: "coherente-5-5",
    name: "Coherente 5-5",
    summary: "Cinco y cinco, sin retenciones. Seis respiraciones por minuto: el patrón que se sostiene sin esfuerzo.",
    phases: [
      { kind: "inhale", seconds: 5 },
      { kind: "exhale", seconds: 5 },
    ],
    min_cycles: 3,
    max_cycles: 12,
    // Sin conteo: a este ritmo la voz contando estorba más de lo que guía.
    counting: "none",
    breath_sounds: true,
    lead_in_seconds: 11,
    gap_seconds: 4,
    tail_seconds: 8,
    i18n: {
      en: {
        name: "Coherent 5-5",
        summary: "Five and five, no holds. Six breaths a minute: the pattern you can hold without effort.",
      },
    },
  },
  {
    slug: "suspiro-fisiologico",
    name: "Suspiro fisiológico",
    summary: "Dos inhalaciones seguidas y una exhalación larga. El más rápido para cortar una activación alta.",
    phases: [
      { kind: "inhale", seconds: 3, level: 0.72 },
      { kind: "inhale", seconds: 1, level: 1, cue: "sip" },
      { kind: "exhale", seconds: 7 },
    ],
    min_cycles: 3,
    // Tope más bajo que el resto: el suspiro es corto por diseño — la dosis
    // habitual son tres a cinco — pero con el hueco en dos minutos se queda muy
    // por debajo, así que llega hasta siete antes de devolverle tiempo a la sesión.
    max_cycles: 7,
    counting: "last",
    breath_sounds: true,
    lead_in_seconds: 13,
    gap_seconds: 4,
    tail_seconds: 8,
    i18n: {
      en: {
        name: "Physiological sigh",
        summary: "Two inhales back to back and one long exhale. The fastest way to cut high activation.",
      },
    },
  },
];

async function main() {
  requireEnv("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");
  log.title("Cargando el banco curado");

  await ensureBucket();
  log.ok(`Bucket de audio listo`);

  /* Voces */
  const { error: voiceError } = await db()
    .from("omtana_voices")
    .upsert(
      VOICES.map((v, i) => ({ ...v, sort: i })),
      { onConflict: "slug", ignoreDuplicates: false },
    );
  if (voiceError) fatal(`Voces: ${voiceError.message}`);
  log.ok(`${VOICES.length} voces`);
  log.info("Falta enlazarlas con ElevenLabs: npm run voices:link");

  /* Intenciones */
  const { error: intentionError } = await db()
    .from("omtana_intentions")
    .upsert(
      INTENTIONS.map((it, i) => ({ ...it, active: true, sort: i })),
      { onConflict: "slug", ignoreDuplicates: false },
    );
  if (intentionError) fatal(`Intenciones: ${intentionError.message}`);
  log.ok(`${INTENTIONS.length} intenciones`);

  /*
   * El banco es lo que dice este archivo. Lo que se sacó de acá se desactiva en
   * vez de borrarse: puede haber meditaciones apuntando a esa fila. Las de
   * categoría `libre` son intenciones escritas a mano por la gente, no del
   * banco, así que no se tocan.
   */
  const { error: retireError, count: retired } = await db()
    .from("omtana_intentions")
    .update({ active: false }, { count: "exact" })
    .eq("active", true)
    .neq("category", "libre")
    .not("slug", "in", `(${INTENTIONS.map((it) => it.slug).join(",")})`);
  if (retireError) fatal(`Intenciones: ${retireError.message}`);
  if (retired) log.info(`${retired} intenciones antiguas fuera del banco`);

  /* Ejercicios de respiración */
  const { error: breathingError } = await db()
    .from("omtana_breathing_exercises")
    .upsert(
      BREATHING.map((b, i) => ({ ...b, sort: i })),
      { onConflict: "slug", ignoreDuplicates: false },
    );
  if (breathingError) fatal(`Respiración: ${breathingError.message}`);
  log.ok(`${BREATHING.length} ejercicios de respiración`);
  log.info("Falta grabarlos: npm run respiracion -- --voz aurora");

  /* Música: lo que haya en assets/music */
  if (!existsSync(MUSIC_DIR)) {
    log.warn(`No existe ${MUSIC_DIR}/ — sin música de fondo por ahora.`);
    log.info("Deja ahí tus pistas de Suno (.mp3) y vuelve a correr el seed.");
  } else {
    const files = (await readdir(MUSIC_DIR)).filter((f) =>
      AUDIO_EXTENSIONS.includes(extname(f).toLowerCase()),
    );

    if (files.length === 0) {
      log.warn(`${MUSIC_DIR}/ está vacío — sin música de fondo por ahora.`);
    }

    for (const file of files) {
      const title = trackName(file);
      const slug = slugify(title);
      const local = join(MUSIC_DIR, file);
      const path = `music/${slug}.mp3`;

      log.step(`música · ${file}`);
      await uploadAudio(path, await readFile(local));

      const { error } = await db().from("omtana_music_tracks").upsert(
        {
          slug,
          name: titleize(title),
          mood: "ambiente",
          audio_path: path,
          duration_seconds: Math.round(await durationOf(local)),
        },
        { onConflict: "slug" },
      );
      if (error) fatal(`Música ${file}: ${error.message}`);
    }

    if (files.length) log.ok(`${files.length} pistas de música`);
  }

  log.done("Banco cargado. Siguiente: npm run voices:link y npm run respiracion");
}

function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * El nombre de la pista, sin extensión.
 *
 * Quita las extensiones de audio repetidas: lo que sale de una conversión suele
 * llegar como "pista.wav.mp3", y con un solo `basename` el nombre visible
 * terminaba siendo "Pista.wav".
 */
function trackName(file: string): string {
  let name = file;
  while (AUDIO_EXTENSIONS.includes(extname(name).toLowerCase())) {
    name = basename(name, extname(name));
  }
  return name;
}

function titleize(text: string): string {
  const clean = text.replace(/[-_]+/g, " ").trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

main().catch((err) => fatal(err instanceof Error ? err.message : String(err)));
