import { Link } from '@tanstack/react-router';

export function NotFound() {
  return (
    <>
      <h1>Not found</h1>
      <p>There's no page or data at this address.</p>
      <p>
        <Link to="/">Back to the home page</Link>
      </p>
    </>
  );
}
