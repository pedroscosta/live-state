# live-state

[![CodSpeed](https://img.shields.io/badge/CodSpeed-Performance%20Tracking-blue?logo=codspeed)](https://codspeed.io/pedroscosta/live-state?utm_source=badge)

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

> [!IMPORTANT]  
> Live-state is currently in alpha. It's not ready for production use. Use at your own risk.

```bash
pnpm add @live-state/sync
```

### Development

Clone the repository and install dependencies:

```bash
git clone https://github.com/pedroscosta/live-state.git
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
