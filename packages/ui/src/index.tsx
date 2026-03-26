import type { ButtonHTMLAttributes, InputHTMLAttributes, PropsWithChildren, HTMLAttributes } from 'react';
import './styles.css';

type ButtonVariant = 'primary' | 'ghost';

export function UIButton(
  props: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
  }>,
) {
  const variant = props.variant ?? 'primary';
  const { variant: _variant, className, ...rest } = props;
  return (
    <button
      type={rest.type ?? 'button'}
      {...rest}
      className={`nbk-btn nbk-btn--${variant}${className ? ` ${className}` : ''}`}
    >
      {props.children}
    </button>
  );
}

export function UICard(props: PropsWithChildren<HTMLAttributes<HTMLElement>>) {
  const { className, children, ...rest } = props;
  return (
    <section {...rest} className={`nbk-card${className ? ` ${className}` : ''}`}>
      {children}
    </section>
  );
}

export function UIInput(
  props: Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> & {
    onChange: (value: string) => void;
  },
) {
  const { className, onChange, ...rest } = props;
  return (
    <input
      {...rest}
      onChange={(event) => onChange(event.target.value)}
      type={rest.type ?? 'text'}
      className={`nbk-input${className ? ` ${className}` : ''}`}
    />
  );
}

export function UIPill(props: PropsWithChildren<HTMLAttributes<HTMLSpanElement>>) {
  const { className, children, ...rest } = props;
  return (
    <span {...rest} className={`nbk-pill${className ? ` ${className}` : ''}`}>
      {children}
    </span>
  );
}
