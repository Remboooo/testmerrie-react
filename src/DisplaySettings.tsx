import { ReactNode, forwardRef, useImperativeHandle, useRef, useState } from 'react';
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

export type EffectKey = 'chroma' | 'scanlines' | 'grain' | 'bulge' | 'glow';
export type EffectState = { enabled: boolean; amount: number };
export type PresetName = 'off' | 'cinematic' | 'retro' | 'custom';

// Deliberately English, unlike the rest of the app's Dutch UI copy — the
// Dutch translations for these read awkwardly ("Chromatische aberratie",
// "Filmkorrel") for what are pretty technical/jargon-y terms to begin with.
const EFFECT_CONFIG: {
  key: EffectKey;
  label: string;
  icon: string;
  // Whether the checkbox / slider can do anything on the SVG fallback, or
  // needs WebGL to mean anything at all.
  checkboxNeedsWebgl: boolean;
  sliderNeedsWebgl: boolean;
}[] = [
  { key: 'chroma', label: 'Chromatic aberration', icon: '🎨', checkboxNeedsWebgl: false, sliderNeedsWebgl: true },
  { key: 'glow', label: 'Blur', icon: '☁️', checkboxNeedsWebgl: false, sliderNeedsWebgl: false },
  { key: 'scanlines', label: 'Scanlines', icon: '📺', checkboxNeedsWebgl: false, sliderNeedsWebgl: false },
  { key: 'grain', label: 'Film grain', icon: '🎞️', checkboxNeedsWebgl: true, sliderNeedsWebgl: true },
  { key: 'bulge', label: 'CRT bulge', icon: '🌐', checkboxNeedsWebgl: true, sliderNeedsWebgl: true },
];

const PRESET_OPTIONS: { key: PresetName; emoji: string; label: string }[] = [
  { key: 'off', emoji: '🚫', label: 'Off' },
  { key: 'cinematic', emoji: '🎬', label: 'Cinematic' },
  { key: 'retro', emoji: '📼', label: 'Retro' },
  { key: 'custom', emoji: '🎛️', label: 'Custom' },
];

// A pill-in-a-pill segmented switch, like the on/off toggles this is
// modeled after — a sliding indicator behind N equal-width emoji buttons
// rather than a dropdown, since the options are meant to be a quick, visual
// pick rather than a list to scan.
function PresetSwitch({ value, onChange }: { value: PresetName; onChange: (v: PresetName) => void }) {
  const index = PRESET_OPTIONS.findIndex((o) => o.key === value);
  const n = PRESET_OPTIONS.length;
  return (
    <Box sx={{ position: 'relative', display: 'flex', bgcolor: 'action.hover', borderRadius: '999px', height: '2.5rem' }}>
      <Box
        sx={{
          position: 'absolute',
          top: '3px',
          bottom: '3px',
          left: `calc(${index} * 100% / ${n} + 3px)`,
          width: `calc(100% / ${n} - 6px)`,
          bgcolor: 'primary.main',
          borderRadius: '999px',
          transition: 'left 200ms ease',
        }}
      />
      {PRESET_OPTIONS.map(({ key, emoji, label }) => (
        <Tooltip key={key} title={label}>
          <Box
            onClick={() => onChange(key)}
            sx={{
              position: 'relative',
              zIndex: 1,
              flex: '1 1 0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontSize: '1.3rem',
            }}
          >
            {emoji}
          </Box>
        </Tooltip>
      ))}
    </Box>
  );
}

export type DisplaySettingsProps = {
  webglEnabled: boolean;
  onWebglEnabledChange: (v: boolean) => void;
  webglSupport: WebglSupport;
  effectiveRenderer: 'webgl' | 'svg';
  effects: Record<EffectKey, EffectState>;
  onEffectChange: (key: EffectKey, patch: Partial<EffectState>) => void;
  preset: PresetName;
  onPresetChange: (preset: PresetName) => void;
  // Lets the same popover be opened from a differently-styled trigger (the
  // drawer's gear button vs. the video-corner quick-access button) without
  // duplicating the popover content itself. All optional — the drawer usage
  // gets the plain gear button unchanged.
  triggerIcon?: ReactNode;
  triggerSx?: SxProps<Theme>;
  triggerAriaLabel?: string;
  anchorOrigin?: PopoverOrigin;
  transformOrigin?: PopoverOrigin;
  // Fires whenever the popover opens/closes — lets a caller keep its trigger
  // visible for the duration (the video-corner button shouldn't slide away
  // on mouse-idle while its own popover is still open and being adjusted).
  onOpenChange?: (open: boolean) => void;
  // Called when the trigger is clicked, before the popover would open.
  // Returning `false` redirects the click elsewhere (e.g. the drawer's copy
  // redirects to the video-corner one, to teach where it lives) and
  // suppresses this instance's own popover for that click.
  onTriggerClick?: () => boolean | void;
};

export type DisplaySettingsHandle = {
  // Opens the popover anchored on this instance's own trigger button, as if
  // it had been clicked directly.
  open: () => void;
};

const DisplaySettings = forwardRef<DisplaySettingsHandle, DisplaySettingsProps>(function DisplaySettings({
  webglEnabled,
  onWebglEnabledChange,
  webglSupport,
  effectiveRenderer,
  effects,
  onEffectChange,
  preset,
  onPresetChange,
  triggerIcon,
  triggerSx,
  triggerAriaLabel,
  anchorOrigin,
  transformOrigin,
  onOpenChange,
  onTriggerClick,
}, ref) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  useImperativeHandle(ref, () => ({
    open: () => {setAnchorEl(buttonRef.current); onOpenChange?.(true);},
  }));

  const webglToggleDisabled = webglSupport !== 'available';
  const webglTooltip = webglSupport === 'unavailable'
    ? 'WebGL wordt niet ondersteund door deze browser of videokaart'
    : webglSupport === 'checking'
      ? 'WebGL wordt gecontroleerd…'
      : '';

  return (
    <>
      <IconButton
        ref={buttonRef}
        onClick={(event) => {
          if (onTriggerClick?.() === false) return;
          setAnchorEl(event.currentTarget); onOpenChange?.(true);
        }}
        aria-label={triggerAriaLabel ?? 'Effectinstellingen'}
        sx={triggerSx}
      >
        {triggerIcon ?? <Settings />}
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={!!anchorEl}
        onClose={() => {setAnchorEl(null); onOpenChange?.(false);}}
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

          <PresetSwitch value={preset} onChange={onPresetChange} />

          <Divider sx={{ my: 1 }} />

          {EFFECT_CONFIG.map(({ key, label, icon, checkboxNeedsWebgl, sliderNeedsWebgl }) => {
            const state = effects[key];
            // With the preset off, these controls doing nothing (effectsEnabled
            // gates rendering entirely) while still looking interactive was
            // confusing — disable them, and touching one no longer silently
            // flips the preset to "custom" out from under the "off" choice.
            const presetOff = preset === 'off';
            const checkboxDisabled = presetOff || (checkboxNeedsWebgl && effectiveRenderer !== 'webgl');
            const sliderDisabled = checkboxDisabled || (sliderNeedsWebgl && effectiveRenderer !== 'webgl') || !state.enabled;
            const reason = presetOff ? 'Preset is off' : checkboxDisabled ? 'Requires WebGL' : '';
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
});

export default DisplaySettings;
