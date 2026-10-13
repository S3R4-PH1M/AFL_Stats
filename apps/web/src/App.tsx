import { DATA_CONTRACT_VERSION } from '@afl/core';

export interface AppProps {
  buildTime: string;
}

export function App({ buildTime }: AppProps) {
  return (
    <main>
      <h1>AFL Stats</h1>
      <p>Team form, player comparisons and all-time records. Coming soon.</p>
      <p className="meta">
        Data contract {DATA_CONTRACT_VERSION} · built <time dateTime={buildTime}>{buildTime}</time>
      </p>
    </main>
  );
}
