// Example projects, bundled as CSV text (the same format users save).
import fourBar from './four-bar.csv?raw';
import sliderCrank from './slider-crank.csv?raw';
import quickReturn from './quick-return.csv?raw';
import boom from './hydraulic-boom.csv?raw';

export interface Example {
  file: string;
  name: string;
  description: string;
  text: string;
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
];
