import Script from 'next/script'

// RBMC branch only: the public status pages report visits to Victor's Umami at stats.marotta.dev
// (paschendale.net disbelief/umami). Admin pages stay untracked.
export default function StatusLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Script
        src="https://stats.marotta.dev/script.js"
        data-website-id="8da16d64-a4be-4682-aa6a-f7f274a59731"
        strategy="afterInteractive"
      />
    </>
  )
}
