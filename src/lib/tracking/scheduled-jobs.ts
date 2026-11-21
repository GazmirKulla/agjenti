/** The scheduled runs (vercel.json), each one a folder under src/app/api/cron; the coverage test checks the list. */
export const scheduledJobs = {
  "account-deletions": "Fshirja e llogarive", "booking-reminders": "Kujtesat e rezervimeve", "business-attention": "Njoftimet për pronarët", "business-discovery": "Analiza e bizneseve (radha)",
  campaigns: "Fushatat (radha)", "capability-health": "Matja ditore e shëndetit", "conversation-training": "Importi i bisedave (radha)",
  "mobile-notifications": "Njoftimet në celular", "participant-avatars": "Fotot e kontakteve", "prospect-scans": "Leximi i profileve të klientëve",
  "refresh-instagram-tokens": "Rifreskimi i token-ave të Instagram", "source-refresh": "Rifreskimi javor i burimeve", "workflow-inbound": "Radha e proceseve",
} as const;
export const scheduledJobCapability = (job: string) => `system.cron.${job.replace(/-/g, "_")}`;
