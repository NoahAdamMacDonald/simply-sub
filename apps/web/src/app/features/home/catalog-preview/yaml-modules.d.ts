// TEMPORARY (catalog preview): angular.json loads .yaml files as text ("loader": { ".yaml": "text" }).
declare module '*.yaml' {
  const text: string;
  export default text;
}
