import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Link } from 'react-router-dom'
import { isApprovedCelestialHref } from './celestial-links'

/**
 * Renders Celestial answers. Raw HTML is never parsed (no rehype-raw), images are dropped, links
 * only go to approved internal screens, and tables scroll horizontally instead of overflowing.
 */
export function CelestialMarkdown({ content }: { content: string }) {
  return (
    <div className="celestial-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        skipHtml
        disallowedElements={['img']}
        unwrapDisallowed
        components={{
          a: ({ href, children }) =>
            isApprovedCelestialHref(href) ? (
              <Link to={href} className="celestial-md-link">
                {children}
              </Link>
            ) : (
              <span>{children}</span>
            ),
          table: ({ children }) => (
            <div className="celestial-md-table-wrap">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
