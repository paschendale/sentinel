import type { Metadata } from 'next'
import { TestEditor } from '../_components/test-editor'

export const metadata: Metadata = { title: 'New test' }

export default function NewTestPage() {
  return <TestEditor />
}
