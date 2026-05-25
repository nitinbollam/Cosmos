// Local entry so Metro computes SHA-1 (pnpm symlinks break export on some setups).
import '@expo/metro-runtime'

import { App } from 'expo-router/build/qualified-entry'
import { renderRootComponent } from 'expo-router/build/renderRootComponent'

renderRootComponent(App)
