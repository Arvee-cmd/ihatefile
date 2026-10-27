import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'

function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className='container max-w-3xl py-10'>
      <h1 className='text-3xl font-semibold tracking-tight'>{title}</h1>
      <div className='mt-6 space-y-4 leading-relaxed [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:ms-5 [&_ul]:list-disc [&_ul]:space-y-1'>
        {children}
      </div>
    </div>
  )
}

export function PrivacyPage() {
  return (
    <Page title='Privacy'>
      <p>
        ihatefile has no accounts, no ads and no analytics in this codebase.
        What happens to your file depends on the tool you pick, and the
        converter tells you before it happens.
      </p>
      <h2>Browser-side tools</h2>
      <p>
        Image conversion, PDF merge/extract, image to PDF, ZIP creation and the
        data tools (JSON, CSV, XML, Base64, URL) run entirely in your browser.
        The file is read from your device, converted in memory and handed back
        to you as a download. It is not sent to any server. You can verify this
        in your browser's network panel or by going offline.
      </p>
      <h2>Server-side tools</h2>
      <p>
        Office-to-PDF, text-document conversion, PDF text/page images, audio,
        video, TIFF/ICO/GIF/BMP images and archive re-packing need engines
        (LibreOffice, Pandoc, FFmpeg, Pillow) that cannot run in a browser. For
        these, the file is uploaded over the connection your browser uses to
        reach the server (HTTPS in production). You are asked to confirm before
        the first upload.
      </p>
      <ul>
        <li>
          The uploaded file is processed in an isolated worker process with time
          and memory limits and is deleted as soon as the conversion finishes or
          fails.
        </li>
        <li>
          The result is stored under a random, unguessable ID, your browser
          downloads it immediately, and then asks the server to delete it. If
          that request is lost, the server deletes it automatically after a
          short retention period (10 minutes by default).
        </li>
        <li>
          No conversion history or database is kept. Temporary files are wiped
          when the server restarts.
        </li>
        <li>
          The server logs technical facts only (tool, formats, sizes, duration,
          status), never file names or contents. Hosting providers may keep
          their own request logs (such as IP addresses).
        </li>
      </ul>
      <h2>What we can't promise</h2>
      <p>
        Server processing means your file is, briefly, on someone else's
        computer. If a file is highly sensitive, use a browser-side tool, run
        the open-source server yourself, or don't upload it. Deletion happens
        when described above, but we cannot control copies made by network
        intermediaries or the hosting provider's infrastructure.
      </p>
      <h2>Cookies and storage</h2>
      <p>
        Your theme choice is kept in a cookie. Your upload confirmation is
        remembered in session storage until you close the tab. Nothing is used
        for tracking.
      </p>
      <p className='text-sm text-muted-foreground'>
        This page describes the software's behaviour. If you operate a public
        instance, review and adapt it to your hosting setup and local law.
      </p>
    </Page>
  )
}

export function TermsPage() {
  return (
    <Page title='Terms'>
      <p>
        ihatefile is provided free of charge and "as is", without warranty of
        any kind. Conversions can change or lose information (see the
        limitations listed for each tool); keep your original files.
      </p>
      <ul>
        <li>
          Only convert files you have the right to use. Don't upload illegal
          content or files intended to harm the service.
        </li>
        <li>
          Server usage is limited (file size, speed and concurrency) and may be
          restricted to keep the service available for everyone.
        </li>
        <li>
          The operator is not liable for loss or corruption of data arising from
          use of the service.
        </li>
        <li>
          The software is open source under the MIT license; see{' '}
          <Link to='/about' className='underline'>
            About
          </Link>{' '}
          for attribution.
        </li>
      </ul>
      <p className='text-sm text-muted-foreground'>
        These terms are a plain-language template, not legal advice. Operators
        of a public deployment should review them with a qualified professional.
      </p>
    </Page>
  )
}

export function AboutPage() {
  return (
    <Page title='About ihatefile'>
      <p>
        ihatefile is a free, open-source file converter. It prefers converting
        in your browser for privacy and cost, and uses a small FastAPI server
        only for conversions that genuinely need native engines. Every
        conversion listed is implemented and covered by automated tests;
        anything unsupported is listed on the{' '}
        <Link to='/formats' className='underline'>
          formats page
        </Link>
        .
      </p>
      <h2>Built with</h2>
      <p>
        React, Vite, TypeScript, Tailwind CSS and shadcn/ui on the front end;
        pdf-lib and fflate in the browser; FastAPI, Pillow,
        pypdf/pdfplumber/pypdfium2, LibreOffice, Pandoc and FFmpeg on the
        server.
      </p>
      <p>
        The interface is built on the MIT-licensed <em>shadcn-admin</em> starter
        by Sat Naing, and its license is retained in the repository.
      </p>
      <h2 id='support'>Support &amp; feedback</h2>
      <p>
        Found a file that doesn't convert correctly? Please report it to whoever
        operates this instance, or open an issue in the project's source
        repository, including the tool, the formats and the error message.
        Please don't attach files that contain private information.
      </p>
    </Page>
  )
}
