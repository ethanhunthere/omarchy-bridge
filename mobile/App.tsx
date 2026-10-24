// App shell entry. Implementation lives under ./src:
//   src/AppRoot.tsx        — providers + layout composition
//   src/hooks/useBridge.ts — connection, pairing, terminal + hardware state
//   src/components/*       — dumb views (header, terminal, power, modals)
//   src/lib/*              — bridge targets, ANSI parser
//   src/theme/*            — selectable palette tokens + provider
export { default } from './src/AppRoot';
