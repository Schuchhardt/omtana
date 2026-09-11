export const TERMS_UPDATED = "1 de septiembre de 2026";

export interface TermsSection {
  id: string;
  title: string;
  paragraphs: string[];
}

export const TERMS: TermsSection[] = [
  {
    id: "servicio",
    title: "1. Qué es este servicio",
    paragraphs: [
      "Omtana es una aplicación que genera meditaciones guiadas combinando audio pregenerado con tramos escritos y sintetizados para cada persona a partir de la intención que declara.",
      "Al crear una cuenta aceptas estos términos. Si no estás de acuerdo con alguna parte, no uses el servicio.",
    ],
  },
  {
    id: "cuenta",
    title: "2. Tu cuenta",
    paragraphs: [
      "Necesitas un correo válido y una contraseña para tener biblioteca propia. Eres responsable de mantener la contraseña en reserva y de la actividad que ocurra con tu cuenta.",
      "Puedes cerrar tu cuenta cuando quieras desde tu perfil. Al hacerlo se elimina tu biblioteca personal; las meditaciones que publicaste dejan de mostrar tu nombre.",
    ],
  },
  {
    id: "creditos",
    title: "3. Créditos y pagos",
    paragraphs: [
      "Escuchar el catálogo público es gratis. Generar una meditación personalizada consume un crédito, porque implica costos reales de generación de texto y de síntesis de voz.",
      "Los pagos se procesan a través de Stripe. No almacenamos datos de tu tarjeta. Los créditos no vencen. Las suscripciones se renuevan de forma automática y puedes cancelarlas en cualquier momento, con efecto al final del período pagado.",
    ],
  },
  {
    id: "contenido",
    title: "4. Contenido generado",
    paragraphs: [
      "Las meditaciones se generan con modelos de lenguaje y síntesis de voz. Pueden contener errores o formulaciones que no se ajusten a lo que esperabas.",
      "La meditación que generas con un crédito queda disponible en tu biblioteca mientras tu cuenta esté activa. No hay exportación ni descarga de audio.",
    ],
  },
  {
    id: "publicacion",
    title: "5. Publicación en la comunidad",
    paragraphs: [
      "Puedes publicar las meditaciones que generas. Al publicarlas autorizas a Omtana a mostrarlas a otros usuarios dentro de la aplicación, junto a tu nombre de usuario.",
      "Puedes volver a dejarlas privadas cuando quieras. Podemos retirar contenido que sea ofensivo, engañoso o que dé indicaciones de salud peligrosas.",
    ],
  },
  {
    id: "video",
    title: "6. Uso en video",
    paragraphs: [
      "Las meditaciones producidas por el equipo de Omtana pueden publicarse como video en canales propios. Las meditaciones de usuarios no se publican fuera de la aplicación sin autorización expresa.",
    ],
  },
  {
    id: "salud",
    title: "7. Esto no es tratamiento médico",
    paragraphs: [
      "Omtana es una herramienta de bienestar. No diagnostica, no trata y no reemplaza atención médica ni psicológica.",
      "Si atraviesas una crisis de salud mental, consulta a un profesional o a los servicios de urgencia de tu país. No uses meditaciones guiadas mientras conduces u operas maquinaria.",
    ],
  },
  {
    id: "datos",
    title: "8. Tus datos",
    paragraphs: [
      "Guardamos tu correo, las intenciones que declaras, las sesiones que completas y las voces que eliges. Esos datos se usan para hacer funcionar el servicio y para mejorar lo que se genera.",
      "No vendemos datos personales identificables. Puedes pedir una copia de tus datos o su eliminación escribiéndonos, y respondemos dentro de treinta días.",
    ],
  },
  {
    id: "cambios",
    title: "9. Cambios en estos términos",
    paragraphs: [
      "Si cambiamos algo relevante, te avisamos por correo con al menos quince días de anticipación. Seguir usando el servicio después de esa fecha significa que aceptas la nueva versión.",
    ],
  },
];
