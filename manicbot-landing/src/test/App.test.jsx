import { render, screen } from '@testing-library/react';
import App from '../App';

describe('App', () => {
  it('renders the landing page shell', () => {
    render(<App />);

    expect(screen.getAllByText('ManicBot').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: /main navigation/i })).toBeInTheDocument();
  });
});
