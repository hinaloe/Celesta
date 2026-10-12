import type { ReactNode } from 'react';

import { StaticScene } from './static-scene';

function Inline({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

export default function Root() {
  return <StaticScene Wrap={Inline} />;
}
