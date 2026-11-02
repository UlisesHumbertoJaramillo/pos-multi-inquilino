// Cambio entre modo claro y oscuro.
import DarkModeOutlined from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlined from '@mui/icons-material/LightModeOutlined';
import { IconButton, Tooltip } from '@mui/material';
import { useColorScheme } from '@mui/material/styles';

export function ColorModeToggle() {
  const { mode, systemMode, setMode } = useColorScheme();
  const current = mode === 'system' ? systemMode : mode;
  const next = current === 'dark' ? 'light' : 'dark';
  return (
    <Tooltip title={next === 'dark' ? 'Modo oscuro' : 'Modo claro'}>
      <IconButton
        aria-label={next === 'dark' ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro'}
        onClick={() => {
          setMode(next);
        }}
      >
        {next === 'dark' ? <DarkModeOutlined /> : <LightModeOutlined />}
      </IconButton>
    </Tooltip>
  );
}
