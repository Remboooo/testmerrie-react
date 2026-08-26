import { ReactNode, useState } from 'react';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Slider from '@mui/material/Slider';
import Tooltip from '@mui/material/Tooltip';
import Divider from '@mui/material/Divider';
import Box from '@mui/material/Box';
import Settings from '@mui/icons-material/Settings';
import { SxProps, Theme } from '@mui/material/styles';
import type { PopoverOrigin } from '@mui/material/Popover';
import { WebglSupport } from './webgl/useWebglSupport';

export type EffectKey = 'chroma' | 'scanlines' | 'grain' | 'bulge';
export type EffectState = { enabled: boolean; amount: number };

const EFFECT_CONFIG: {
  key: EffectKey;
  label: string;
  icon: string;
  // Whether the checkbox / slider can do anything on the SVG fallback, or
  // needs WebGL to mean anything at all.
  checkboxNeedsWebgl: boolean;
  sliderNeedsWebgl: boolean;
}[] = [
  { key: 'chroma', label: 'Chromatische aberratie', icon: '🎨', checkboxNeedsWebgl: false, sliderNeedsWebgl: true },
  { key: 'scanlines', label: 'Scanlines', icon: '📺', checkboxNeedsWebgl: false, sliderNeedsWebgl: false },
  { key: 'grain', label: 'Filmkorrel', icon: '🎞️', checkboxNeedsWebgl: true, sliderNeedsWebgl: true },
  { key: 'bulge', label: 'CRT-bolling', icon: '🌐', checkboxNeedsWebgl: true, sliderNeedsWebgl: true },
];

export type DisplaySettingsProps = {
  // The effects master switch (a separate checkbox next to this button in
  // the drawer) — when off, the gear can't be opened at all, mirroring how
  // WebGL-only controls inside it are greyed out rather than hidden.
  disabled: boolean;
  webglEnabled: boolean;
  onWebglEnabledChange: (v: boolean) => void;
  webglSupport: WebglSupport;
  effectiveRenderer: 'webgl' | 'svg';
  effects: Record<EffectKey, EffectState>;
  onEffectChange: (key: EffectKey, patch: Partial<EffectState>) => void;
  // Lets the same popover be opened from a differently-styled trigger (the
  // drawer's gear button vs. the video-corner quick-access button) without
  // duplicating the popover content itself. All optional — the drawer usage
  // gets the plain gear button unchanged.
  triggerIcon?: ReactNode;
  triggerSx?: SxProps<Theme>;
  triggerAriaLabel?: string;
  anchorOrigin?: PopoverOrigin;
  transformOrigin?: PopoverOrigin;
};

export default function DisplaySettings({
  disabled,
  webglEnabled,
  onWebglEnabledChange,
  webglSupport,
  effectiveRenderer,
  effects,
  onEffectChange,
  triggerIcon,
  triggerSx,
  triggerAriaLabel,
  anchorOrigin,
  transformOrigin,
}: DisplaySettingsProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const webglToggleDisabled = webglSupport !== 'available';
  const webglTooltip = webglSupport === 'unavailable'
    ? 'WebGL wordt niet ondersteund door deze browser of videokaart'
    : webglSupport === 'checking'
      ? 'WebGL wordt gecontroleerd…'
      : '';

  return (
    <>
      <IconButton
        disabled={disabled}
        onClick={(event) => setAnchorEl(event.currentTarget)}
        aria-label={triggerAriaLabel ?? 'Effectinstellingen'}
        sx={triggerSx}
      >
        {triggerIcon ?? <Settings />}
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={!!anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={anchorOrigin}
        transformOrigin={transformOrigin}
      >
        <Box sx={{ px: 2, py: 1, minWidth: '18em' }}>
          <Tooltip title={webglTooltip} disableHoverListener={!webglTooltip}>
            <span>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={webglEnabled}
                    disabled={webglToggleDisabled}
                    onChange={(_, checked) => onWebglEnabledChange(checked)}
                  />
                }
                label="WebGL"
              />
            </span>
          </Tooltip>

          <Divider sx={{ my: 1 }} />

          {EFFECT_CONFIG.map(({ key, label, icon, checkboxNeedsWebgl, sliderNeedsWebgl }) => {
            const state = effects[key];
            const checkboxDisabled = checkboxNeedsWebgl && effectiveRenderer !== 'webgl';
            const sliderDisabled = checkboxDisabled || (sliderNeedsWebgl && effectiveRenderer !== 'webgl') || !state.enabled;
            const reason = checkboxDisabled ? 'Vereist WebGL' : '';
            return (
              <Box key={key} sx={{ mb: 1 }}>
                <Tooltip title={reason} disableHoverListener={!reason}>
                  <span>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={state.enabled}
                          disabled={checkboxDisabled}
                          onChange={(_, checked) => onEffectChange(key, { enabled: checked })}
                        />
                      }
                      label={`${icon} ${label}`}
                    />
                  </span>
                </Tooltip>
                <Slider
                  size="small"
                  value={state.amount}
                  min={0}
                  max={100}
                  disabled={sliderDisabled}
                  onChange={(_, value) => onEffectChange(key, { amount: value as number })}
                  sx={{ ml: 1, width: 'calc(100% - 2em)' }}
                />
              </Box>
            );
          })}
        </Box>
      </Menu>
    </>
  );
}
