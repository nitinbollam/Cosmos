import * as React from 'react'
import { cn } from './cn'

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: 'white' | 'blush'
}

export function Card({ className, tone = 'white', ...rest }: CardProps) {
  return <div className={cn('cosmos-card', tone === 'blush' && 'bento-tone-blush', className)} {...rest} />
}

export function CardTitle({ className, ...rest }: CardProps) {
  return <h3 className={cn('bento-section-title', className)} {...rest} />
}

export function CardSection({ className, ...rest }: CardProps) {
  return <div className={cn('mt-3', className)} {...rest} />
}
