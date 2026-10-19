// 法术位表、已知 / 戏法数量表、以及「没人指定时」的默认法术偏好表。
// 数量表按 2014 规则（SRD 5.1 的职业表）。法术位表和 ODM 的 spell-slots.json 逐行核对过。
import type { ClassId } from '../../contract.js';

/** 全施法者法术位，下标 = 施法者等级 - 1，每项 = 各环阶的位数（从 1 环开始）。多职业施法者表也是这张。 */
export const FULL_CASTER_SLOTS: number[][] = [
  [2],
  [3],
  [4, 2],
  [4, 3],
  [4, 3, 2],
  [4, 3, 3],
  [4, 3, 3, 1],
  [4, 3, 3, 2],
  [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

/** 半施法者（圣武士 / 游侠）单职业法术位，下标 = 职业等级 - 1；1 级没有。 */
export const HALF_CASTER_SLOTS: number[][] = [
  [],
  [2],
  [3],
  [3],
  [4, 2],
  [4, 2],
  [4, 3],
  [4, 3],
  [4, 3, 2],
  [4, 3, 2],
  [4, 3, 3],
  [4, 3, 3],
  [4, 3, 3, 1],
  [4, 3, 3, 1],
  [4, 3, 3, 2],
  [4, 3, 3, 2],
  [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2],
];

/** 三分之一施法者（奥法骑士 / 诡术师）单职业法术位，下标 = 职业等级 - 1；3 级才有。 */
export const THIRD_CASTER_SLOTS: number[][] = [
  [],
  [],
  [2],
  [3],
  [3],
  [3],
  [4, 2],
  [4, 2],
  [4, 2],
  [4, 3],
  [4, 3],
  [4, 3],
  [4, 3, 2],
  [4, 3, 2],
  [4, 3, 2],
  [4, 3, 3],
  [4, 3, 3],
  [4, 3, 3],
  [4, 3, 3, 1],
  [4, 3, 3, 1],
];

/** 契约魔法：下标 = 邪术师等级 - 1，[位数, 法术位环阶]。 */
export const PACT_SLOTS: [number, number][] = [
  [1, 1],
  [2, 1],
  [2, 2],
  [2, 2],
  [2, 3],
  [2, 3],
  [2, 4],
  [2, 4],
  [2, 5],
  [2, 5],
  [3, 5],
  [3, 5],
  [3, 5],
  [3, 5],
  [3, 5],
  [3, 5],
  [4, 5],
  [4, 5],
  [4, 5],
  [4, 5],
];

/** 戏法数：[1 级, 4 级, 10 级] 的数量。 */
export const CANTRIPS_KNOWN: Partial<Record<ClassId, [number, number, number]>> = {
  bard: [2, 3, 4],
  cleric: [3, 4, 5],
  druid: [2, 3, 4],
  sorcerer: [4, 5, 6],
  warlock: [2, 3, 4],
  wizard: [3, 4, 5],
};

/** 已知型施法者的已知法术数（不含戏法），下标 = 职业等级 - 1。 */
export const SPELLS_KNOWN: Partial<Record<ClassId, number[]>> = {
  bard: [4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 15, 16, 18, 19, 19, 20, 22, 22, 22],
  sorcerer: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 13, 13, 14, 14, 15, 15, 15, 15],
  warlock: [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15],
  ranger: [0, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11],
};

/** 奥法骑士 / 诡术师的已知法术数，下标 = 职业等级 - 1。 */
export const THIRD_CASTER_SPELLS_KNOWN = [0, 0, 3, 4, 4, 4, 5, 6, 6, 7, 8, 8, 9, 10, 10, 11, 11, 11, 12, 13];

/** 奥法骑士 / 诡术师：能学的两个学派，其它学派的只能占「任意学派」名额（3 级 1 个，8 / 14 / 20 级各加 1 个）。 */
export const THIRD_CASTER_SCHOOLS: Record<string, [string, string]> = {
  eldritch_knight: ['abjuration', 'evocation'],
  arcane_trickster: ['enchantment', 'illusion'],
};

export const thirdCasterAnySchoolPicks = (level: number): number => (level >= 20 ? 4 : level >= 14 ? 3 : level >= 8 ? 2 : level >= 3 ? 1 : 0);

export function cantripsKnownFor(classId: ClassId, level: number): number {
  const row = CANTRIPS_KNOWN[classId];
  if (!row) return 0;
  return level >= 10 ? row[2] : level >= 4 ? row[1] : row[0];
}

const ids = (s: string): string[] => s.split(/\s+/).filter(Boolean);

/**
 * 「没人指定法术时」的默认偏好：每个职业、每个环阶一串有序的 SRD 5.1 / PHB 法术 id，
 * 排在前面的优先。默认选择是确定的（和 SPELLS 里现在有哪些法术无关），选完后才用 SPELLS 过滤。
 * 每个 id 都核对过在 spell-lists.gen.ts 里属于对应职业、环阶也对（test/builder.test.ts 里有这条检查）。
 */
export const DEFAULT_SPELLS: Partial<Record<string, { cantrips: string[]; levels: Record<number, string[]> }>> = {
  bard: {
    cantrips: ids('vicious_mockery minor_illusion mage_hand prestidigitation light dancing_lights message true_strike friends mending'),
    levels: {
      1: ids('healing_word dissonant_whispers charm_person faerie_fire sleep heroism thunderwave cure_wounds tashas_hideous_laughter detect_magic disguise_self comprehend_languages feather_fall identify silent_image speak_with_animals bane longstrider'),
      2: ids('hold_person invisibility suggestion shatter heat_metal lesser_restoration enhance_ability calm_emotions enthrall detect_thoughts silence locate_object see_invisibility zone_of_truth blindness_deafness crown_of_madness phantasmal_force knock'),
      3: ids('hypnotic_pattern dispel_magic fear bestow_curse major_image clairvoyance speak_with_dead tongues sending plant_growth leomunds_tiny_hut glyph_of_warding nondetection stinking_cloud'),
      4: ids('dimension_door polymorph greater_invisibility compulsion confusion hallucinatory_terrain freedom_of_movement locate_creature'),
      5: ids('dominate_person mass_cure_wounds hold_monster modify_memory seeming greater_restoration animate_objects legend_lore scrying geas dream raise_dead teleportation_circle mislead'),
      6: ids('mass_suggestion true_seeing eyebite ottos_irresistible_dance guards_and_wards programmed_illusion'),
      7: ids('teleport mirage_arcane project_image regenerate resurrection symbol etherealness'),
      8: ids('dominate_monster feeblemind glibness power_word_stun mind_blank'),
      9: ids('power_word_kill foresight true_polymorph'),
    },
  },
  cleric: {
    cantrips: ids('sacred_flame guidance spare_the_dying light thaumaturgy mending resistance'),
    levels: {
      1: ids('cure_wounds bless healing_word guiding_bolt shield_of_faith command sanctuary protection_from_evil_and_good detect_magic inflict_wounds bane create_or_destroy_water purify_food_and_drink detect_evil_and_good'),
      2: ids('spiritual_weapon lesser_restoration hold_person aid prayer_of_healing silence calm_emotions augury warding_bond zone_of_truth blindness_deafness find_traps enhance_ability gentle_repose locate_object'),
      3: ids('spirit_guardians revivify dispel_magic mass_healing_word beacon_of_hope bestow_curse protection_from_energy remove_curse clairvoyance daylight speak_with_dead tongues sending glyph_of_warding magic_circle create_food_and_water meld_into_stone water_walk'),
      4: ids('banishment death_ward guardian_of_faith freedom_of_movement divination control_water locate_creature stone_shape'),
      5: ids('mass_cure_wounds flame_strike greater_restoration raise_dead commune dispel_evil_and_good geas insect_plague scrying contagion'),
      6: ids('heal harm heroes_feast blade_barrier word_of_recall true_seeing planar_ally find_the_path'),
      7: ids('resurrection regenerate fire_storm divine_word conjure_celestial etherealness plane_shift symbol'),
      8: ids('holy_aura earthquake antimagic_field control_weather'),
      9: ids('mass_heal gate true_resurrection astral_projection'),
    },
  },
  druid: {
    cantrips: ids('produce_flame guidance shillelagh druidcraft thorn_whip poison_spray mending resistance'),
    levels: {
      1: ids('cure_wounds healing_word entangle faerie_fire goodberry thunderwave fog_cloud speak_with_animals animal_friendship detect_magic jump longstrider purify_food_and_drink detect_poison_and_disease create_or_destroy_water'),
      2: ids('moonbeam pass_without_trace heat_metal barkskin lesser_restoration flaming_sphere spike_growth hold_person gust_of_wind darkvision enhance_ability animal_messenger locate_animals_or_plants locate_object protection_from_poison find_traps beast_sense'),
      3: ids('call_lightning conjure_animals dispel_magic plant_growth sleet_storm water_breathing wind_wall protection_from_energy speak_with_plants daylight meld_into_stone water_walk'),
      4: ids('polymorph wall_of_fire ice_storm blight conjure_woodland_beings freedom_of_movement stoneskin giant_insect confusion dominate_beast control_water locate_creature hallucinatory_terrain'),
      5: ids('wall_of_stone mass_cure_wounds insect_plague tree_stride commune_with_nature greater_restoration conjure_elemental scrying awaken reincarnate contagion'),
      6: ids('heal sunbeam conjure_fey heroes_feast transport_via_plants wall_of_thorns move_earth find_the_path'),
      7: ids('fire_storm regenerate mirage_arcane reverse_gravity'),
      8: ids('sunburst earthquake control_weather animal_shapes'),
      9: ids('shapechange storm_of_vengeance foresight true_resurrection'),
    },
  },
  paladin: {
    cantrips: [],
    levels: {
      1: ids('cure_wounds bless shield_of_faith command divine_favor heroism protection_from_evil_and_good detect_magic detect_evil_and_good purify_food_and_drink'),
      2: ids('aid lesser_restoration find_steed branding_smite magic_weapon zone_of_truth locate_object protection_from_poison'),
      3: ids('revivify dispel_magic daylight create_food_and_water remove_curse magic_circle blinding_smite elemental_weapon aura_of_vitality crusaders_mantle'),
      4: ids('death_ward banishment locate_creature staggering_smite aura_of_purity aura_of_life'),
      5: ids('raise_dead dispel_evil_and_good geas banishing_smite circle_of_power destructive_wave'),
    },
  },
  ranger: {
    cantrips: [],
    levels: {
      1: ids('hunters_mark cure_wounds goodberry fog_cloud longstrider jump speak_with_animals animal_friendship alarm detect_magic ensnaring_strike hail_of_thorns'),
      2: ids('pass_without_trace spike_growth barkskin lesser_restoration protection_from_poison silence locate_animals_or_plants darkvision find_traps beast_sense cordon_of_arrows'),
      3: ids('conjure_animals plant_growth water_walk wind_wall protection_from_energy speak_with_plants daylight nondetection lightning_arrow conjure_barrage'),
      4: ids('freedom_of_movement stoneskin conjure_woodland_beings locate_creature grasping_vine'),
      5: ids('commune_with_nature tree_stride swift_quiver conjure_volley'),
    },
  },
  sorcerer: {
    cantrips: ids('fire_bolt mage_hand light ray_of_frost minor_illusion prestidigitation shocking_grasp chill_touch acid_splash poison_spray'),
    levels: {
      1: ids('magic_missile shield sleep burning_hands charm_person thunderwave mage_armor feather_fall chromatic_orb color_spray fog_cloud disguise_self'),
      2: ids('misty_step scorching_ray invisibility mirror_image hold_person suggestion web shatter blur darkness'),
      3: ids('fireball counterspell fly haste dispel_magic lightning_bolt hypnotic_pattern slow major_image protection_from_energy stinking_cloud'),
      4: ids('greater_invisibility polymorph dimension_door banishment blight ice_storm wall_of_fire stoneskin confusion'),
      5: ids('cone_of_cold hold_monster telekinesis cloudkill dominate_person animate_objects teleportation_circle'),
      6: ids('disintegrate chain_lightning globe_of_invulnerability sunbeam mass_suggestion true_seeing'),
      7: ids('finger_of_death teleport plane_shift fire_storm prismatic_spray'),
      8: ids('dominate_monster sunburst power_word_stun incendiary_cloud'),
      9: ids('wish meteor_swarm time_stop power_word_kill gate'),
    },
  },
  warlock: {
    cantrips: ids('eldritch_blast minor_illusion mage_hand chill_touch prestidigitation true_strike poison_spray friends'),
    levels: {
      1: ids('hex armor_of_agathys hellish_rebuke charm_person protection_from_evil_and_good comprehend_languages unseen_servant witch_bolt expeditious_retreat illusory_script'),
      2: ids('misty_step hold_person invisibility darkness suggestion shatter mirror_image crown_of_madness enthrall ray_of_enfeeblement spider_climb cloud_of_daggers'),
      3: ids('counterspell hypnotic_pattern fear fly dispel_magic vampiric_touch hunger_of_hadar major_image remove_curse tongues magic_circle gaseous_form'),
      4: ids('banishment dimension_door blight hallucinatory_terrain'),
      5: ids('hold_monster dream scrying contact_other_plane'),
 // 6-9 环是神秘秘法的候选，不占已知法术名额
      6: ids('mass_suggestion true_seeing eyebite circle_of_death arcane_gate flesh_to_stone create_undead'),
      7: ids('finger_of_death plane_shift etherealness forcecage'),
      8: ids('dominate_monster demiplane feeblemind glibness power_word_stun'),
      9: ids('power_word_kill astral_projection foresight imprisonment'),
    },
  },
  wizard: {
    cantrips: ids('fire_bolt mage_hand light ray_of_frost minor_illusion prestidigitation shocking_grasp chill_touch acid_splash poison_spray message dancing_lights mending true_strike'),
    levels: {
      1: ids('magic_missile shield sleep mage_armor burning_hands detect_magic identify charm_person thunderwave find_familiar feather_fall grease fog_cloud comprehend_languages expeditious_retreat jump longstrider color_spray disguise_self silent_image tensers_floating_disk unseen_servant witch_bolt protection_from_evil_and_good'),
      2: ids('misty_step scorching_ray invisibility mirror_image web hold_person darkness shatter suggestion levitate knock detect_thoughts blur melfs_acid_arrow flaming_sphere magic_weapon see_invisibility arcane_lock alter_self darkvision enlarge_reduce gust_of_wind spider_climb'),
      3: ids('fireball counterspell fly haste dispel_magic lightning_bolt hypnotic_pattern slow major_image leomunds_tiny_hut clairvoyance protection_from_energy stinking_cloud sleet_storm vampiric_touch animate_dead bestow_curse remove_curse gaseous_form water_breathing nondetection magic_circle sending tongues'),
      4: ids('greater_invisibility polymorph dimension_door wall_of_fire ice_storm banishment blight fire_shield stoneskin arcane_eye confusion phantasmal_killer evards_black_tentacles locate_creature otilukes_resilient_sphere fabricate hallucinatory_terrain'),
      5: ids('cone_of_cold wall_of_force hold_monster telekinesis scrying animate_objects cloudkill dominate_person teleportation_circle creation dream wall_of_stone passwall mislead seeming legend_lore modify_memory conjure_elemental geas'),
      6: ids('disintegrate chain_lightning globe_of_invulnerability sunbeam true_seeing mass_suggestion programmed_illusion contingency create_undead flesh_to_stone move_earth wall_of_ice eyebite circle_of_death arcane_gate'),
      7: ids('finger_of_death teleport forcecage plane_shift delayed_blast_fireball prismatic_spray reverse_gravity mirage_arcane sequester symbol etherealness simulacrum project_image'),
      8: ids('power_word_stun sunburst maze mind_blank clone dominate_monster feeblemind incendiary_cloud antimagic_field demiplane control_weather'),
      9: ids('wish meteor_swarm time_stop power_word_kill foresight gate astral_projection shapechange true_polymorph prismatic_wall weird'),
    },
  },
  // 奥法骑士用法师表，但 1–4 环只能从塑能 / 防护学派选（再加几个任意学派名额）
  eldritch_knight: {
    cantrips: ids('fire_bolt shocking_grasp ray_of_frost mage_hand light prestidigitation true_strike'),
    levels: {
      1: ids('shield magic_missile burning_hands thunderwave protection_from_evil_and_good mage_armor'),
      2: ids('shatter scorching_ray flaming_sphere melfs_acid_arrow magic_weapon gust_of_wind arcane_lock'),
      3: ids('counterspell fireball lightning_bolt protection_from_energy dispel_magic magic_circle'),
      4: ids('fire_shield ice_storm wall_of_fire banishment stoneskin otilukes_resilient_sphere'),
    },
  },
  arcane_trickster: {
    cantrips: ids('mage_hand minor_illusion fire_bolt message prestidigitation true_strike light'),
    levels: {
      1: ids('sleep charm_person disguise_self silent_image color_spray tashas_hideous_laughter illusory_script'),
      2: ids('invisibility suggestion blur mirror_image phantasmal_force hold_person darkness'),
      3: ids('hypnotic_pattern major_image fear slow'),
      4: ids('greater_invisibility confusion phantasmal_killer hallucinatory_terrain'),
    },
  },
};
