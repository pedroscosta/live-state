# live-state

live-state is a high-performance, real-time sync engine written in TypeScript.

## Features

- Real-time bidirectional state synchronization
- Built-in client store with fine-grained reactive
- Optimistic updates
- Built-in ORM

## Monorepo Structure

This repository is organized as a pnpm monorepo:

- `packages/live-state`: Core synchronization engine (client/server API).
- `examples/ls-imp`: Reference implementation.
- `examples/api`: Server example using Express and WebSockets.
- `examples/storefront`: Frontend demo showing live-state in action.

## Getting Started

### Installation

> [!NOTE]
> Live-state is currently in pre-alpha stage. So there is no npm package.

Clone the repository and install dependencies:

```bash
git clone <repo-url>  # replace with your repository URL
cd live-state
pnpm install
```

### Building

```bash
pnpm build
```

### Development

Watch for changes and rebuild:

```bash
pnpm dev
```

## Documentation

Detailed API documentation is available in the `packages/live-state/src` directory.

## Contributing

Contributions are welcome! Please open issues and pull requests.

## License

Apache License 2.0