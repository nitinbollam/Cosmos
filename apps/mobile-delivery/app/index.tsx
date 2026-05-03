import { Redirect } from 'expo-router'

/** Auth gate — delivery driver shell starts at login. */
export default function Index() {
  return <Redirect href="/(auth)/login" />
}
