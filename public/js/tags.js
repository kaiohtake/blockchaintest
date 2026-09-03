// The closed stage-direction vocabulary. The model may emit these; anything
// else in brackets is spoken as text.
export const TAGS = {
  "[leans in]":    { lean: 0.08, letterbox: true, fov: -4, sfx: "creak",  shake: 0 },
  "[leans back]":  { lean: -0.05, letterbox: false, fov: 2, sfx: "creak", shake: 0 },
  "[slams table]": { lean: 0.03, letterbox: true, fov: -2, sfx: "slam",  shake: 120, flicker: true },
  "[taps pen]":    { sfx: "tick" },
  "[checks file]": { headDown: 0.25 },
  "[sighs]":       { lean: -0.02, headDown: 0.08 },
  "[stares]":      { lean: 0.02, letterbox: true, fov: -3, stare: true },
  "[closes file]": { lean: -0.06, letterbox: false, fov: 3, sfx: "creak", headDown: 0.2, end: true },
};

export const TAG_SET = new Set(Object.keys(TAGS));
export const MAX_TAG_LEN = 16;
