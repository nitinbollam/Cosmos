type ImgProps = {
  src: string
  alt: string
  width?: number
  height?: number
  className?: string
  style?: React.CSSProperties
  priority?: boolean
}

export default function Image({ src, alt, width, height, className, style }: ImgProps) {
  return <img src={src} alt={alt} width={width} height={height} className={className} style={style} />
}
