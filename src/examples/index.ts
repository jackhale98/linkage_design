// Example projects, bundled as CSV text (the same format users save).
import fourBar from './four-bar.csv?raw';
import sliderCrank from './slider-crank.csv?raw';
import quickReturn from './quick-return.csv?raw';
import boom from './hydraulic-boom.csv?raw';
import cam from './cam.csv?raw';

export interface Example {
  file: string;
  name: string;
  description: string;
  text: string;
  /** Workspace to open the example in, if not the current one. */
  workspace?: 'cam';
}

export const EXAMPLES: Example[] = [
  {
    file: 'four-bar.csv',
    name: 'Four-bar with coupler point',
    description: 'Grashof crank-rocker; trace the coupler curve',
    text: fourBar,
  },
  {
    file: 'slider-crank.csv',
    name: 'Slider-crank',
    description: 'Crank, connecting rod and piston on a slide',
    text: sliderCrank,
  },
  {
    file: 'quick-return.csv',
    name: 'Quick-return',
    description: 'Crank driving a slotted lever (inverted slider-crank)',
    text: quickReturn,
  },
  {
    file: 'hydraulic-boom.csv',
    name: 'Hydraulic boom',
    description: 'Boom raised by a linear actuator',
    text: boom,
  },
  {
    file: 'cam.csv',
    name: 'Dwell-rise-dwell cam',
    description: 'Roller follower with a return spring, at 300 rpm',
    text: cam,
    workspace: 'cam',
  },
];
