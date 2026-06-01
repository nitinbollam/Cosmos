import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Link } from 'react-router-dom'

export function CelestialMarkdown({ content }: { content: string }) {
  return (
    <div className="celestial-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith('/')) {
              return (
                <Link to={href} className="celestial-md-link">
                  {children}
                </Link>
              )
            }
            return (
              <a href={href} target="_blank" rel="noreferrer" className="celestial-md-link">
                {children}
              </a>
            )
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
