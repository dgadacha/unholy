import type { Vec3 } from '../../formats/bsp';

/** 56-unit standing hull ≈ 1.80 m. Convert the oversized authoring grid once. */
export const BUILDING_SCALE = 0.625;
export const buildingPoint = (point: Vec3): Vec3 => point.map(value => value * BUILDING_SCALE) as Vec3;
