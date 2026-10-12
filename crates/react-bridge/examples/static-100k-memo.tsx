// static-100k.tsx with the still rects in a React.memo component instead of
// <Static>: the baseline it is measured against.
import { Film, Memoized } from './static-100k-scene';

export default function Root() {
  return <Film><Memoized /></Film>;
}
