import { AppProvider } from './AppContext'
import { AppShell } from './AppShell'

export function App(): JSX.Element {
  return <AppProvider><AppShell /></AppProvider>
}
