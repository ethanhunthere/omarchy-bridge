// App shell entry. Implementation follows FSD slices under ./src:
//   src/app/                — providers + layout composition
//   src/views/              — terminal + system screens
//   src/widgets/            — header, composer (keycaps + input)
//   src/features/           — settings + confirmation dialogs
//   src/entities/bridge/    — controller hooks, targets, ANSI parser
//   src/shared/             — theme tokens/provider, error boundary
export { default } from './src/app';
