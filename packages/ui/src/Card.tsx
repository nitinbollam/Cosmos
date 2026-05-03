import * as React from 'react'
import { cn } from './cn'

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {}

export function Card({ className, ...rest }: CardProps) {
  return <div className={cn('cosmos-card p-4', className)} {...rest} />
}

export function CardTitle({ className, ...rest }: CardProps) {
  return <h3 className={cn('text-cosmos-white font-semibold text-base', className)} {...rest} />
}

export function CardSection({ className, ...rest }: CardProps) {
  return <div className={cn('mt-3', className)} {...rest} />
}
