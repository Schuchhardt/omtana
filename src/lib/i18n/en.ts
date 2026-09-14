import type { Copy } from ".";

/** English dictionary. Mirrors `es` key by key; TypeScript enforces it. */
export const en: Copy = {
  htmlLang: "en",
  langSwitchLabel: "Change language",

  common: {
    loading: "Loading…",
    cancel: "Cancel",
    change: "Change",
    dash: "—",
    minutes: "min",
    minutesWithValue: "{n} min",
  },

  nav: {
    howItWorks: "How it works",
    voices: "Voices",
    plans: "Plans",
    home: "Home",
    customize: "Customize",
    library: "Library",
    profile: "Profile",
    signIn: "Sign in",
    signUp: "Create account",
    signOut: "Sign out",
    signOutShort: "SIGN OUT",
    openMenu: "Open menu",
    closeMenu: "Close menu",
  },

  meta: {
    title: "Omtana — Generated meditations",
    description:
      "Omtana builds the meditation around your case: script, voice and music. Every session opens with breathing.",
    ogDescription: "Stop hunting for the meditation that comes closest. Tell us what you need today.",
    titles: {
      access: "Sign in",
      catalog: "Public catalogue",
      home: "Home",
      library: "My library",
      voices: "Voice bank",
      profile: "My profile",
      customize: "Customize",
      plans: "Plans and credits",
      terms: "Terms and conditions",
      player: "Player",
    },
  },

  /* ───────────────────────────── landing ───────────────────────────── */

  hero: {
    eyebrow: "Generated meditations",
    title: "Stop hunting for the meditation that comes closest. Tell us what you need today.",
    body: "Omtana builds the meditation around your case: script, voice and music. Every session opens with breathing, because that is what gets you to the state you are after sooner.",
    ctaHome: "Go to my home",
    ctaSignUp: "Create a free account",
    ctaListen: "Listen to a 5-minute one",
    note: "No card required. The public catalogue is always free.",
  },

  steps: [
    {
      n: "01",
      title: "Intention",
      body: "Pick from a curated bank of intentions, or write your own. You never start from a blank screen.",
    },
    {
      n: "02",
      title: "Personalization",
      body: "Passages written for your context are woven into that base. The rest is already recorded, so the wait is short.",
    },
    {
      n: "03",
      title: "Voice",
      body: "You choose who speaks to you. Accent, gender and tone. Each voice is a consistent character, not a settings checkbox.",
    },
  ],

  breathing: {
    eyebrow: "Breathing first",
    title: "Every session opens with one or two breathing exercises",
    body: "It is not decoration at the door. There is literature showing that certain breathing patterns bring the body into a relaxed state faster than verbal instruction alone. That is why the pattern comes before the script, and not the other way around.",
    cardTitle: "Anatomy of a 15-minute session",
    cardNote:
      "The pale blocks already exist. Only the coloured dot is written for you, and that is why generation takes less than a minute.",
  },

  pricing: {
    eyebrow: "Pricing",
    title: "Personalizing costs money, so we charge for it",
    body: "Listening to the catalogue is free. Generating a meditation burns tokens and voice synthesis, and the price says so without dressing it up.",
  },

  plans: {
    currentBadge: "Current",
    currentCta: "Your current plan",
    free: {
      tag: "Free",
      per: "forever",
      features: [
        "The full public catalogue",
        "3 personalizations a month",
        "You can publish what you generate",
      ],
      cta: "Start free",
    },
    credits: {
      tag: "Credits",
      per: "per meditation",
      features: ["Pay only when you generate", "The meditation is yours", "No subscription"],
      cta: "Buy credits",
    },
    pro: {
      tag: "Pro",
      per: "per month",
      features: [
        "Unlimited generation",
        "New voices before everyone else",
        "Sessions of up to 20 minutes",
      ],
      cta: "Go Pro",
    },
  },

  faq: {
    eyebrow: "Questions",
    title: "What people ask us before signing up",
    items: [
      {
        q: "How is this different from an app with a catalogue?",
        a: "You are not picking whatever comes closest to your case. You state what you want to achieve and the script is written around that, with your context inside it.",
      },
      {
        q: "How long does it take to generate a meditation?",
        a: "Less than a minute. Most of the audio is already pre-generated; only the personalized passages are created on the spot and woven in.",
      },
      {
        q: "Can I download the audio?",
        a: "No. Meditations are listened to inside Omtana. What you generate stays in your library for as long as you have an account.",
      },
      {
        q: "What happens to what I write in my context?",
        a: "It is used to write your meditation. It does not appear in the sessions you publish and is not shared with other users.",
      },
      {
        q: "Which languages is it in?",
        a: "Spanish, English and Portuguese, each with its own voices. The language of the meditation is chosen separately from the language of the interface.",
      },
    ],
  },

  youtube: {
    eyebrow: "Also on YouTube",
    title: "The same meditations, on video",
    body: "Audio wave, key words and music. We publish full sessions every week, free and with no account.",
    caption: "exported frame · 1920×1080",
  },

  footer: {
    tagline: "Meditations generated from your intention.",
    languages: "Meditations in Spanish, English and Portuguese",
    copyright: "© 2026 Omtana",
    terms: "Terms and conditions",
    privacy: "Privacy",
    columns: { product: "Product", account: "Account", legal: "Legal" },
    links: {
      howItWorks: "How it works",
      voices: "Voice bank",
      plans: "Plans and credits",
      youtube: "YouTube channel",
      signIn: "Sign in",
      signUp: "Create account",
      library: "My library",
      profile: "My profile",
    },
  },

  setupNotice: {
    before: "Supabase is not connected yet. Copy ",
    between: " to ",
    afterFile: " and run ",
    after: ".",
    note: "You can still walk through the design.",
  },

  /* ───────────────────────────── access ───────────────────────────── */

  access: {
    aside: "We only ask for what it takes for your library to follow you.",
    tabSignIn: "Sign in",
    tabSignUp: "Create account",
    titleSignUp: "Your library starts here",
    titleSignIn: "Welcome back",
    bodySignUp:
      "We create the account so that what you generate follows you. The public catalogue needs no account.",
    bodySignIn: "Sign in to get back to your library and this month's personalizations.",
    labelName: "Name",
    placeholderName: "What should we call you",
    labelEmail: "Email",
    placeholderEmail: "you@email.com",
    labelPassword: "Password",
    placeholderPasswordSignUp: "At least 8 characters",
    placeholderPasswordSignIn: "Your password",
    termsBefore: "I accept the ",
    termsLink: "terms and conditions",
    termsAfter: " and the use of my intentions to generate meditations.",
    submitSignUp: "Create a free account",
    submitSignIn: "Sign in",
    pendingSignUp: "Creating your account…",
    pendingSignIn: "Signing in…",
    noteSignUp: "Just email and password. We do not ask for a card on the Free plan.",
    noteSignIn: "Forgot your password? Write to us at hola@omtana.com.",
    errors: {
      invalidEmail: "That email does not look valid.",
      shortPassword: "The password needs at least 8 characters.",
      missingName: "Your name is missing.",
      mustAcceptTerms: "You have to accept the terms to create the account.",
      missingPassword: "The password is missing.",
      emailTaken: "There is already an account with that email. Sign in instead of creating one.",
      createFailed: "We could not create the account. Try again.",
      badCredentials: "Wrong email or password.",
    },
  },

  /* ───────────────────────────── catalogue ───────────────────────────── */

  catalog: {
    eyebrow: "Catalogue",
    title: "Ready to listen, no generating",
    body: "What the team produces plus what the community chose to publish. Free and with no account.",
    emptyBefore: "The catalogue is still empty. Run ",
    emptyAfter: " to pre-generate the initial bank.",
    filterAll: "All",
    languageLabel: "Language",
    emptyFilter: "There are no meditations in this language yet.",
    seeAll: "See all",
    fallbackNote: "There are no meditations in {language} yet. These are in other languages.",
    ctaBefore: "Want one built around your case? ",
    ctaLink: "Create an account",
    ctaAfter: ".",
  },

  /* ───────────────────────────── home ───────────────────────────── */

  home: {
    title: "What do you want to achieve today?",
    quotaPro: "Pro plan · unlimited generation",
    quotaFree: "{used} of {total} personalizations this month",
    bankTitle: "Intention bank",
    bankNote: "Ready to listen, no generating",
    bankEmptyBefore: "The bank is still empty. Run ",
    bankEmptyAfter: " to load the curated intentions.",
    continueTitle: "Continue",
  },

  intentionInput: {
    ariaLabel: "Your intention",
    placeholder: "Write your intention: I want to sleep without tossing and turning…",
    submit: "Continue",
    suggestionsLabel: "Suggestions",
    suggestions: [
      "Bring anxiety down before sleep",
      "Keep a new habit going",
      "Before a difficult conversation",
      "Five minutes and back to it",
    ],
  },

  /* ───────────────────────────── library ───────────────────────────── */

  library: {
    eyebrow: "Your library",
    titleEmpty: "You have no meditations yet",
    titleCount: { one: "1 meditation of yours", other: "{n} meditations of yours" },
    newCta: "New meditation",
    emptyBefore: "What you generate lands here. Start by stating an intention on ",
    emptyLink: "your home",
    emptyAfter: ".",
    note: "Meditations are listened to inside Omtana; there is no audio download. If you publish one, it becomes available to the community under your name, and you can make it private again whenever you want.",
    filterAll: "All",
    filterPublished: "Published",
    filterPrivate: "Private",
    playAria: "Listen to {title}",
    statusFailed: "failed",
    statusGenerating: "generating",
    public: "Public",
    private: "Private",
    emptyFilter: "Nothing matches that filter.",
  },

  /* ───────────────────────────── voices ───────────────────────────── */

  voices: {
    back: "← Back to customizing",
    eyebrow: "Voice bank",
    title: "Who do you want speaking to you?",
    body: "Each voice leads the session as a consistent character. Listen to the sample before choosing.",
    emptyBefore: "The voice bank is empty. Run ",
    emptyBetween: " and then ",
    emptyAfter: ".",
    filterAll: "All",
    filterFemale: "Female",
    filterMale: "Male",
    filterDeep: "Deep",
    sampleAria: "Listen to a sample of {name}",
    emptyFilter: "No voice in the bank matches that filter yet.",
  },

  /* ───────────────────────────── profile ───────────────────────────── */

  profile: {
    memberSince: "member since {date}",
    viewPlans: "See plans",
    statCompleted: "sessions completed",
    statListened: "listened in total",
    statOwned: "meditations of yours",
    cancel: "Cancel",
    preferences: "Preferences",
    saving: "Saving…",
    saved: "Saved",
    appLanguage: "Application language",
    portugueseNote:
      "The interface is in Spanish and English; meditations can still be in Portuguese.",
    defaultVoice: "Default voice",
    noVoiceChosen: "Not chosen",
    viewBank: "See bank",
    usualDuration: "Usual duration",
    accountAndData: "Account and data",
    toggles: {
      daily_reminder: {
        label: "Daily reminder",
        note: "A nudge at 9pm for your evening session.",
      },
      voice_emails: {
        label: "Emails about new voices",
        note: "When an actor joins the bank.",
      },
      publish_by_default: {
        label: "Publish by default",
        note: "Everything you generate becomes public unless you change it.",
      },
      improve_service: {
        label: "Use my sessions to improve the service",
        note: "Aggregated data, without the text of your context.",
      },
    },
    termsLink: "Terms and privacy",
    signOut: "Sign out",
    deleteAccount: "Delete account and data",
    deleteWarning:
      "Your library and your data are erased. What you published stays in the catalogue, without your name. This cannot be undone.",
    deleteConfirm: "Yes, delete everything",
    deleting: "Deleting…",
    saveError: "We could not save those settings.",
  },

  /* ───────────────────────────── customize ───────────────────────────── */

  customize: {
    defaultIntention: "A meditation for today",
    back: "← Back to the bank",
    eyebrow: "Customize",
    sectionContext: "Your context",
    contextPlaceholder: "Tell us what is specific about your case.",
    contextNote: "The more concrete it is, the more it shows in the personalized passages.",
    sectionDuration: "Duration",
    sectionLanguage: "Meditation language",
    sectionVoice: "Voice",
    noVoice: "No voice",
    loadVoiceBank: "Load the voice bank",
    sectionBreathing: "Breathing",
    noBreathing: "No breathing",
    noBreathingNote:
      "The session starts straight in the body, and those minutes go to your personalized passage.",
    noBreathingAvailable:
      "No exercises recorded with this voice for this length yet.",
    breathingPregenerated: "Its own audio and animation",
    sectionWhenDone: "When it is done",
    optionPrivate: "Private",
    optionPublish: "Publish",
    publishNote:
      "It becomes available to the community under your name. You can make it private again whenever you want.",
    privateNote: "Just for you. Nobody else sees it in the catalogue.",
    summaryTitle: "Your session",
    generatedForYou: "Generated for you",
    pregenerated: "Pre-generated",
    linePersonalized: "Personalized passages",
    lineVoice: "Voice",
    lineCost: "Cost",
    costPro: "Included in Pro",
    costIncluded: "Included ({n} left)",
    costCredit: { one: "{n} credit", other: "{n} credits" },
    generate: "Generate meditation",
    starting: "Starting…",
    noCredits: "No credits",
    readyNote: "Ready in under a minute",
    blockedLink: "Buy credits or go Pro to keep generating.",
    errorFallback: "We could not start the generation.",
  },

  /* ───────────────────────────── plans ───────────────────────────── */

  plansPage: {
    eyebrow: "Plans and credits",
    title: "You are on the {plan} plan",
    bodyPro: "Unlimited generation. It renews automatically and you can cancel whenever you want.",
    bodyFree: { one: "You have {n} of {total} personalizations left this month.", other: "You have {n} of {total} personalizations left this month." },
    renewsOn: " It renews on {date}.",
    alsoCredits: { one: " You also have {n} credit.", other: " You also have {n} credits." },
    paidOk: "Payment received. If the credits are not showing yet, reload in a few seconds.",
    paidCancelled: "You cancelled the payment. Nothing was charged.",
    ledgerTitle: "Activity",
    ledgerEmpty: "No activity yet.",
    buyCredits: "Buy credits",
    creditPacks: {
      pack_1: { qty: "1 credit", unit: "one meditation" },
      pack_5: { qty: "5 credits", unit: "$2.40 each" },
      pack_15: { qty: "15 credits", unit: "$2 each" },
    },
    opening: "Opening…",
    payWithStripe: "Pay with Stripe",
    paymentsOff: "Payments not configured",
    creditsNote: "Credits do not expire. Each one is a meditation of yours, forever.",
    goPro: "Go Pro",
    proNote: "Unlimited generation. It renews every month and cancels whenever you want.",
    checkoutError: "We could not open the payment.",
  },

  /* ───────────────────────────── player ───────────────────────────── */

  player: {
    generating: "Generating",
    preparing: "Getting the session ready",
    readyNote: "Ready in under a minute",
    failedFallback: "The generation failed.",
    refundNote: "We gave the personalization back to you. You can try again.",
    retryCta: "Adjust and retry",
    back15: "Back 15 seconds",
    forward15: "Forward 15 seconds",
    play: "Play",
    pause: "Pause",
    viewInLibrary: "See it in my library",
    changeVoice: "Change voice",
    generateAnother: "Generate another",
    phaseBreathing: "Guided breathing",
    phaseClosing: "Closing",
    phaseYourSegment: "Your passage",
    phaseBody: "Body of the meditation",
    breathingTitle: "Breathing",
    breathingNone: "No breathing",
    breathingSkip: "Skip the breathing",
    breathingCycles: "{n} cycles",
    breathingNote: "It plays before the meditation, at its own pace.",
    phaseInhale: "Inhale",
    phaseHold: "Hold",
    phaseExhale: "Exhale",
    phaseEmpty: "Wait",
    phaseReady: "Get ready",
    phaseSettle: "Let the rhythm go",
    musicTitle: "Background music",
    musicSubtitle: "It plays under the voice, on a loop.",
    musicNone: "No music",
    musicPlay: "Play the background music",
    musicPause: "Pause the background music",
    musicEmpty: "No background tracks loaded yet.",
    musicBakedNote:
      "This session already has music mixed in. Adding a track here means you will hear both.",
    volumeVoice: "Voice",
    volumeMusic: "Music",
    steps: {
      plantilla: "Preparing the structure",
      "plantilla:guion": "Writing the base blocks",
      guion: "Writing your passage",
      mezcla: "Putting the session together",
      guardado: "Saving",
      listo: "Ready",
      voz: "Recording the voice",
      fallback: "Generating",
    },
  },

  /* ───────────────────────────── terms ───────────────────────────── */

  termsPage: {
    eyebrow: "Legal",
    title: "Terms and conditions",
    updated: "Last updated: {date}",
    contactBefore: "If any of this is unclear, write to us at ",
    contactAfter:
      " before accepting. We would rather answer a question than have you accept something you do not understand.",
  },

  terms: {
    updated: "1 September 2026",
    sections: [
      {
        id: "servicio",
        title: "1. What this service is",
        paragraphs: [
          "Omtana is an application that generates guided meditations by combining pre-generated audio with passages written and synthesized for each person from the intention they state.",
          "By creating an account you accept these terms. If you disagree with any part of them, do not use the service.",
        ],
      },
      {
        id: "cuenta",
        title: "2. Your account",
        paragraphs: [
          "You need a valid email and a password to have a library of your own. You are responsible for keeping your password private and for the activity that happens on your account.",
          "You can close your account whenever you want from your profile. Doing so deletes your personal library; the meditations you published stop showing your name.",
        ],
      },
      {
        id: "creditos",
        title: "3. Credits and payments",
        paragraphs: [
          "Listening to the public catalogue is free. Generating a personalized meditation uses a credit, because it involves real costs in text generation and voice synthesis.",
          "Payments are processed through Stripe. We do not store your card details. Credits do not expire. Subscriptions renew automatically and you can cancel them at any time, effective at the end of the paid period.",
        ],
      },
      {
        id: "contenido",
        title: "4. Generated content",
        paragraphs: [
          "Meditations are generated with language models and voice synthesis. They may contain errors or wordings that do not match what you expected.",
          "The meditation you generate with a credit stays available in your library for as long as your account is active. There is no audio export or download.",
        ],
      },
      {
        id: "publicacion",
        title: "5. Publishing to the community",
        paragraphs: [
          "You can publish the meditations you generate. By publishing them you authorize Omtana to show them to other users inside the application, alongside your username.",
          "You can make them private again whenever you want. We may take down content that is offensive, misleading, or that gives dangerous health advice.",
        ],
      },
      {
        id: "video",
        title: "6. Use in video",
        paragraphs: [
          "Meditations produced by the Omtana team may be published as video on our own channels. User meditations are not published outside the application without express authorization.",
        ],
      },
      {
        id: "salud",
        title: "7. This is not medical treatment",
        paragraphs: [
          "Omtana is a wellbeing tool. It does not diagnose, does not treat, and does not replace medical or psychological care.",
          "If you are going through a mental health crisis, consult a professional or your country's emergency services. Do not use guided meditations while driving or operating machinery.",
        ],
      },
      {
        id: "datos",
        title: "8. Your data",
        paragraphs: [
          "We store your email, the intentions you state, the sessions you complete and the voices you choose. That data is used to run the service and to improve what gets generated.",
          "We do not sell identifiable personal data. You can ask for a copy of your data or its deletion by writing to us, and we answer within thirty days.",
        ],
      },
      {
        id: "cambios",
        title: "9. Changes to these terms",
        paragraphs: [
          "If we change anything significant, we tell you by email at least fifteen days in advance. Continuing to use the service after that date means you accept the new version.",
        ],
      },
    ],
  },

  ledger: {
    free_included: "Personalization included in Free",
    credits_purchased: "Purchase of {n} credits",
    pro_activated: "Pro subscription activated",
    refund_failed: "Refund for a failed generation",
    meditation: "{title}",
  },

  /* ───────────────────────────── API ───────────────────────────── */

  api: {
    signInRequired: "You need to sign in.",
    invalidRequest: "Invalid request.",
    invalidValue: "Invalid value.",
    notFound: "Not found.",
    paymentsNotConfigured: "Payments are not configured yet. STRIPE_SECRET_KEY is missing.",
    stripeCreditsDescription: "Credits to generate personalized meditations. They do not expire.",
    missingMeditationData: "Some data is missing to generate the meditation.",
    outOfCredits: "You have run out of personalizations and credits.",
    meditationCreateFailed: "We could not create the meditation.",
    missingProPrice: "STRIPE_PRICE_PRO is missing.",
    packNotFound: "That pack does not exist.",
    updateFailed: "Could not update.",
    invalidEmail: "That email does not look valid.",
  },

  /* ───────────────────────────── formatting ───────────────────────────── */

  format: {
    months: [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ],
    shortDate: "{month} {day}",
    longDate: "{month} {year}",
    greetingMorning: "Good morning",
    greetingAfternoon: "Good afternoon",
    greetingEvening: "Good evening",
    plays: { one: "1 play", other: "{n} plays" },
  },

  /* ──────────────── closed vocabularies stored in the database ──────────────── */

  vocab: {
    sections: {
      "Respiración guiada": "Guided breathing",
      "Entrada al cuerpo": "Settling into the body",
      "Tu contexto": "Your context",
      "Refuerzo e imágenes": "Reinforcement and imagery",
      Cierre: "Closing",
    },
    gender: {
      Femenina: "Female",
      Masculina: "Male",
    },
    tone: {
      Grave: "Deep",
      Media: "Mid",
      Aguda: "Bright",
    },
  },
};
