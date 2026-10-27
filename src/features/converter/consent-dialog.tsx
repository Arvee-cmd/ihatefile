import type { ServerStatus } from '@/lib/api'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useConverter } from './store'

/** Shown before the first server upload so nobody is surprised that a file leaves their device. */
export function ConsentDialog({ status }: { status: ServerStatus }) {
  const { consentRequest, resolveConsent } = useConverter()
  const ttlMin = Math.round((status.limits?.jobTtlSeconds ?? 600) / 60)
  const names = consentRequest?.names ?? []
  return (
    <AlertDialog
      open={!!consentRequest}
      onOpenChange={(o) => !o && resolveConsent(false, status)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Upload to the conversion server?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className='space-y-3 text-sm'>
              <p className='font-medium text-foreground'>
                {names.length === 1 ? '1 file' : `${names.length} files`} will
                leave your device:
              </p>
              <p>
                This conversion can't run in your browser. The file will be sent
                to the ihatefile conversion server, converted, and sent back.
              </p>
              <ul className='max-h-28 list-disc overflow-auto ps-5 break-all'>
                {names.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
              <p>
                The uploaded file is deleted as soon as it is converted, and the
                result is deleted when you download it (or after at most{' '}
                {ttlMin} minutes). Don't upload files you aren't comfortable
                sending to a server.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep files local</AlertDialogCancel>
          <AlertDialogAction
            data-testid='consent-accept'
            onClick={() => resolveConsent(true, status)}
          >
            Upload and convert
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
