// Vite's ?raw imports: a file's text, which the tests read the real catalog files and the fixture pages with.
declare module '*?raw' {
  const text: string;
  export default text;
}
