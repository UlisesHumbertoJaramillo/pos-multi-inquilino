// Estado con su severidad (T-252; RF-188, D-99): color, ícono y texto juntos, para que nunca se
// entienda solo por el color.
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined';
import ErrorOutlined from '@mui/icons-material/ErrorOutlined';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import WarningAmberOutlined from '@mui/icons-material/WarningAmberOutlined';
import { Chip, type SvgIconProps } from '@mui/material';
import { SEVERITY_NAMES, SEVERITY_PALETTE, type Severity } from '../theme';

const ICONS: Record<Severity, typeof InfoOutlined> = {
  critica: ErrorOutlined,
  advertencia: WarningAmberOutlined,
  informativa: InfoOutlined,
  correcta: CheckCircleOutlined,
};

export function SeverityIcon({ severity, ...props }: { severity: Severity } & SvgIconProps) {
  const Icon = ICONS[severity];
  return <Icon color={SEVERITY_PALETTE[severity]} aria-hidden {...props} />;
}

// Severidades de las alertas del backend.
export function alertSeverity(value: 'critica' | 'advertencia' | 'info'): Severity {
  return value === 'info' ? 'informativa' : value;
}

export function Status({
  severity,
  label,
  size = 'small',
}: {
  severity: Severity;
  label: string;
  size?: 'small' | 'medium';
}) {
  const Icon = ICONS[severity];
  return (
    <Chip
      size={size}
      variant="outlined"
      color={SEVERITY_PALETTE[severity]}
      icon={<Icon aria-hidden />}
      label={label}
      aria-label={`${SEVERITY_NAMES[severity]}: ${label}`}
      role="status"
    />
  );
}
