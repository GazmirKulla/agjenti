export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 p-8">
      <p className="text-sm uppercase tracking-wide text-zinc-500">Agjenti.app</p>
      <h1 className="text-4xl font-semibold">Suport me AI për shumë biznese</h1>
      <p className="text-lg text-zinc-600">
        Lidh Instagram, merri bisedat në një inbox, dhe dërgo porositë te faqja e biznesit.
      </p>
      <a href="/login" className="w-fit rounded-lg bg-zinc-900 px-5 py-3 text-white">
        Hyr
      </a>
    </main>
  );
}
