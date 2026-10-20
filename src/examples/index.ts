// Example projects, bundled as CSV text (the same format users save).
import fourBar from './four-bar.csv?raw';
import hoekens from './hoekens.csv?raw';
import watt from './watt.csv?raw';
import sliderCrank from './slider-crank.csv?raw';
import scotchYoke from './scotch-yoke.csv?raw';
import quickReturn from './quick-return.csv?raw';
import shaper from './shaper.csv?raw';
import knucklePress from './knuckle-press.csv?raw';
import pumpJack from './pump-jack.csv?raw';
import boom from './hydraulic-boom.csv?raw';
import steering from './steering.csv?raw';
import cam from './cam.csv?raw';
import camSlide from './cam-slide.csv?raw';
import valveTrain from './valve-train.csv?raw';
import gears from './gears.csv?raw';
import gearedFiveBar from './geared-five-bar.csv?raw';

export const EXAMPLE_GROUPS = ['Linkages', 'Machines and forces', 'Cams and gears'] as const;

export interface Example {
  file: string;
  name: string;
  description: string;
  group: (typeof EXAMPLE_GROUPS)[number];
  text: string;
  /** Workspace to open the example in, if not the current one. */
  workspace?: 'cam';
}

export const EXAMPLES: Example[] = [
  {
    file: 'four-bar.csv',
    name: 'Four-bar with coupler point',
    description: 'Grashof crank-rocker; trace the coupler curve',
    group: 'Linkages',
    text: fourBar,
  },
  {
    file: 'hoekens.csv',
    name: 'Hoekens straight-line linkage',
    description: 'A walking-machine leg: the foot runs straight for half a turn',
    group: 'Linkages',
    text: hoekens,
  },
  {
    file: 'watt.csv',
    name: "Watt's linkage",
    description: 'Two arms and a short link; its centre moves in a straight line',
    group: 'Linkages',
    text: watt,
  },
  {
    file: 'slider-crank.csv',
    name: 'Slider-crank',
    description: 'Crank, connecting rod and piston on a slide',
    group: 'Linkages',
    text: sliderCrank,
  },
  {
    file: 'scotch-yoke.csv',
    name: 'Scotch yoke',
    description: 'Crank pin in a sliding yoke: pure harmonic motion',
    group: 'Linkages',
    text: scotchYoke,
  },
  {
    file: 'quick-return.csv',
    name: 'Quick-return',
    description: 'Crank driving a slotted lever (inverted slider-crank)',
    group: 'Linkages',
    text: quickReturn,
  },
  {
    file: 'shaper.csv',
    name: 'Shaper',
    description: 'Six-bar quick return driving a ram against a cutting force',
    group: 'Linkages',
    text: shaper,
  },
  {
    file: 'knuckle-press.csv',
    name: 'Knuckle-joint press',
    description: 'Toggle links multiply a 20 N·m crank torque into ram force',
    group: 'Machines and forces',
    text: knucklePress,
  },
  {
    file: 'pump-jack.csv',
    name: 'Pump jack',
    description: 'Oil-well beam pump with a crank counterweight',
    group: 'Machines and forces',
    text: pumpJack,
  },
  {
    file: 'hydraulic-boom.csv',
    name: 'Hydraulic boom',
    description: 'Boom raised by a linear actuator',
    group: 'Machines and forces',
    text: boom,
  },
  {
    file: 'steering.csv',
    name: 'Rack-and-pinion steering',
    description: 'Ackermann steering: the inner wheel turns further',
    group: 'Machines and forces',
    text: steering,
  },
  {
    file: 'cam.csv',
    name: 'Dwell-rise-dwell cam',
    description: 'Roller follower with a return spring, at 300 rpm',
    group: 'Cams and gears',
    text: cam,
    workspace: 'cam',
  },
  {
    file: 'cam-slide.csv',
    name: 'Cam-driven slide',
    description: 'A cam on a shaft driving a spring-loaded roller follower',
    group: 'Cams and gears',
    text: camSlide,
  },
  {
    file: 'valve-train.csv',
    name: 'Engine valve train',
    description: 'A cam lifting a roller rocker arm against the valve spring',
    group: 'Cams and gears',
    text: valveTrain,
  },
  {
    file: 'gears.csv',
    name: 'Gear pair and rack',
    description: 'A 20:40 gear pair driving a rack against a load',
    group: 'Cams and gears',
    text: gears,
  },
  {
    file: 'geared-five-bar.csv',
    name: 'Geared five-bar',
    description: 'Meshing gears drive two cranks; the joint traces a loop',
    group: 'Cams and gears',
    text: gearedFiveBar,
  },
];
