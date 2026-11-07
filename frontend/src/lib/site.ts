// Site-wide constants.
export const SITE = {
  name: 'Squeektoshi Care Fund',
  ticker: 'CARE',
  // The project id from the Genesis "Direct submission" tab. The server puts it in the page <head> as
  // <meta name="squeekchain-project" content="…">, which is what Squeekchain's verifier looks for.
  // The same id goes in the repository README as `squeekchain-project: <id>`.
  projectId: null as string | null,
}
