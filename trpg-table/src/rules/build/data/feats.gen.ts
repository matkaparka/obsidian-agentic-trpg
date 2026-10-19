// 自动生成：node src/rules/build/data/gen/generate.mjs
// 来源：Open Dungeon Master（MIT，Copyright (c) 2026 Jacob Ferrari, Kaleb Lutterman），提交 df3fec7，data/srd/authored-feats.json
// 说明文字是 ODM 用自己的话写的 2014 机制复述（非 SRD 原文）。见 ../NOTICE.md。不要手改。
import type { FeatDef } from './schema.js';

export const FEAT_DEFS: FeatDef[] = [
  {
    "id": "athlete",
    "name": "Athlete",
    "prerequisite": "",
    "text": "Increase your Strength or Dexterity by 1, to a maximum of 20. Standing up from prone costs only 5 feet of movement, climbing costs no extra movement, and you can make a running jump after moving only 5 feet."
  },
  {
    "id": "actor",
    "name": "Actor",
    "prerequisite": "",
    "text": "Increase your Charisma by 1, to a maximum of 20. You have advantage on Deception and Performance checks when passing yourself off as someone else, and you can mimic the speech or sounds of a creature you have heard for at least 1 minute."
  },
  {
    "id": "charger",
    "name": "Charger",
    "prerequisite": "",
    "text": "After you Dash, you can use a bonus action to make one melee attack or to shove a creature. If you moved at least 10 feet in a straight line first, the attack deals an extra 5 damage or the shove pushes 10 extra feet."
  },
  {
    "id": "crossbow_expert",
    "name": "Crossbow Expert",
    "prerequisite": "",
    "text": "You ignore the loading property of crossbows you are proficient with, being within 5 feet of a hostile creature gives you no disadvantage on ranged attacks, and when you take the Attack action with a one-handed weapon you can use a bonus action to attack with a hand crossbow you are holding."
  },
  {
    "id": "defensive_duelist",
    "name": "Defensive Duelist",
    "prerequisite": "Dexterity 13 or higher",
    "text": "When a creature hits you with a melee attack while you wield a finesse weapon you are proficient with, you can use your reaction to add your proficiency bonus to your AC against that attack, possibly turning it into a miss."
  },
  {
    "id": "dual_wielder",
    "name": "Dual Wielder",
    "prerequisite": "",
    "text": "You gain +1 AC while wielding a separate melee weapon in each hand, you can two-weapon fight with weapons that lack the light property, and you can draw or stow two one-handed weapons at once."
  },
  {
    "id": "dungeon_delver",
    "name": "Dungeon Delver",
    "prerequisite": "",
    "text": "You have advantage on Perception and Investigation checks to detect secret doors, advantage on saving throws against traps, resistance to trap damage, and you can search for traps while travelling at a normal pace."
  },
  {
    "id": "durable",
    "name": "Durable",
    "prerequisite": "",
    "text": "Increase your Constitution by 1, to a maximum of 20. When you roll a Hit Die to regain hit points, the minimum you regain is twice your Constitution modifier."
  },
  {
    "id": "elven_accuracy",
    "name": "Elven Accuracy",
    "prerequisite": "Elf or half-elf",
    "text": "Increase your Dexterity, Intelligence, Wisdom, or Charisma by 1, to a maximum of 20. Whenever you have advantage on an attack roll using Dexterity, Intelligence, Wisdom, or Charisma, you can reroll one of the dice once. The server rolls a third d20 and keeps the highest."
  },
  {
    "id": "elemental_adept",
    "name": "Elemental Adept",
    "prerequisite": "The ability to cast at least one spell",
    "text": "Choose acid, cold, fire, lightning or thunder. Your spells of that damage type ignore resistance, and any 1 rolled on their damage dice counts as a 2. You can take this feat more than once, choosing a different type each time."
  },
  {
    "id": "great_weapon_master",
    "name": "Great Weapon Master",
    "prerequisite": "",
    "text": "On a critical hit or when you drop a creature to 0 hit points with a melee weapon, you can make one melee weapon attack as a bonus action. Before attacking with a heavy weapon you are proficient with, you can take a -5 penalty to the attack roll in exchange for +10 damage on a hit."
  },
  {
    "id": "healer",
    "name": "Healer",
    "prerequisite": "",
    "text": "When you stabilize a creature with a healer's kit it also regains 1 hit point. As an action you can spend a use of a healer's kit to restore 1d6 + 4 hit points plus the creature's Hit Dice to a creature, once each per rest."
  },
  {
    "id": "heavily_armored",
    "name": "Heavily Armored",
    "prerequisite": "Proficiency with medium armor",
    "text": "Increase your Strength by 1, to a maximum of 20, and gain proficiency with heavy armor."
  },
  {
    "id": "heavy_armor_master",
    "name": "Heavy Armor Master",
    "prerequisite": "Proficiency with heavy armor",
    "text": "Increase your Strength by 1, to a maximum of 20. While you wear heavy armor, bludgeoning, piercing and slashing damage from nonmagical attacks is reduced by 3."
  },
  {
    "id": "inspiring_leader",
    "name": "Inspiring Leader",
    "prerequisite": "Charisma 13 or higher",
    "text": "You can spend 10 minutes rallying up to six friendly creatures within 30 feet who can hear and understand you. Each gains temporary hit points equal to your level plus your Charisma modifier, and cannot benefit again until it finishes a rest."
  },
  {
    "id": "keen_mind",
    "name": "Keen Mind",
    "prerequisite": "",
    "text": "Increase your Intelligence by 1, to a maximum of 20. You always know which way is north and how many hours remain before sunrise or sunset, and you accurately recall anything you have seen or heard in the past month."
  },
  {
    "id": "lightly_armored",
    "name": "Lightly Armored",
    "prerequisite": "",
    "text": "Increase your Strength or Dexterity by 1, to a maximum of 20, and gain proficiency with light armor."
  },
  {
    "id": "linguist",
    "name": "Linguist",
    "prerequisite": "",
    "text": "Increase your Intelligence by 1, to a maximum of 20. You learn three languages and can create written ciphers that others cannot read without an Intelligence check against a DC of 8 plus your Intelligence modifier and proficiency bonus."
  },
  {
    "id": "lucky",
    "name": "Lucky",
    "prerequisite": "",
    "text": "You have three luck points, regained on a long rest. Spend one to roll an extra d20 on your own attack roll, ability check or saving throw and choose which die to use, or to roll an extra d20 on an attack made against you and choose which the attacker uses."
  },
  {
    "id": "magic_initiate",
    "name": "Magic Initiate",
    "prerequisite": "",
    "text": "Choose a class: bard, cleric, druid, sorcerer, warlock or wizard. You learn two cantrips of your choice from that class's spell list. Choose one 1st-level spell from the same list: you learn it and can cast it once without expending a spell slot, at its lowest level, and again after a long rest. Your spellcasting ability for these spells depends on the class you chose: Charisma for bard, sorcerer or warlock; Wisdom for cleric or druid; Intelligence for wizard."
  },
  {
    "id": "mage_slayer",
    "name": "Mage Slayer",
    "prerequisite": "",
    "text": "When a creature within 5 feet casts a spell you can use your reaction to attack it. When you damage a creature concentrating on a spell it has disadvantage on the concentration save, and you have advantage on saves against spells cast by creatures within 5 feet."
  },
  {
    "id": "martial_adept",
    "name": "Martial Adept",
    "prerequisite": "",
    "text": "You learn two maneuvers from the Battle Master list and gain one superiority die of d6, which refills on a short or long rest."
  },
  {
    "id": "medium_armor_master",
    "name": "Medium Armor Master",
    "prerequisite": "Proficiency with medium armor",
    "text": "Wearing medium armor does not impose disadvantage on Stealth checks, and if your Dexterity is 16 or higher you add 3 rather than 2 to your AC from medium armor."
  },
  {
    "id": "mobile",
    "name": "Mobile",
    "prerequisite": "",
    "text": "Your speed increases by 10 feet, difficult terrain costs no extra movement when you Dash, and when you make a melee attack against a creature it cannot make opportunity attacks against you for the rest of the turn."
  },
  {
    "id": "moderately_armored",
    "name": "Moderately Armored",
    "prerequisite": "Proficiency with light armor",
    "text": "Increase your Strength or Dexterity by 1, to a maximum of 20, and gain proficiency with medium armor and shields."
  },
  {
    "id": "mounted_combatant",
    "name": "Mounted Combatant",
    "prerequisite": "",
    "text": "While mounted you have advantage on melee attacks against unmounted creatures smaller than your mount, you can redirect an attack aimed at your mount to yourself, and your mount takes no damage on a successful Dexterity save and half on a failure."
  },
  {
    "id": "observant",
    "name": "Observant",
    "prerequisite": "",
    "text": "Increase your Intelligence or Wisdom by 1, to a maximum of 20. You can read lips, and you gain a +5 bonus to your passive Perception and passive Investigation."
  },
  {
    "id": "polearm_master",
    "name": "Polearm Master",
    "prerequisite": "",
    "text": "When you take the Attack action with a glaive, halberd, quarterstaff or spear you can use a bonus action to strike with the opposite end for 1d4 bludgeoning damage. You also get an opportunity attack when a creature enters your reach with such a weapon."
  },
  {
    "id": "resilient",
    "name": "Resilient",
    "prerequisite": "",
    "text": "Increase one ability score by 1, to a maximum of 20, and gain proficiency in saving throws with that ability."
  },
  {
    "id": "ritual_caster",
    "name": "Ritual Caster",
    "prerequisite": "Intelligence or Wisdom 13 or higher",
    "text": "You gain a ritual book holding two 1st-level ritual spells from a class you choose, and you can cast any ritual in it. You can add further rituals of a level you can cast to the book by copying them."
  },
  {
    "id": "sentinel",
    "name": "Sentinel",
    "prerequisite": "",
    "text": "A creature you hit with an opportunity attack has its speed reduced to 0 for that turn, creatures provoke opportunity attacks from you even if they Disengage, and when a creature within 5 feet attacks someone other than you, you can use your reaction to make a melee attack against it."
  },
  {
    "id": "sharpshooter",
    "name": "Sharpshooter",
    "prerequisite": "",
    "text": "Attacking at long range gives you no disadvantage, your ranged attacks ignore half and three-quarters cover, and before a ranged attack with a weapon you are proficient with you can take a -5 penalty to the attack roll in exchange for +10 damage on a hit."
  },
  {
    "id": "shield_master",
    "name": "Shield Master",
    "prerequisite": "",
    "text": "If you take the Attack action you can use a bonus action to shove a creature within 5 feet with your shield. You add your shield's AC bonus to Dexterity saves against effects that target only you, and you can use a reaction to take no damage on a successful Dexterity save."
  },
  {
    "id": "skulker",
    "name": "Skulker",
    "prerequisite": "Dexterity 13 or higher",
    "text": "You can hide when lightly obscured, missing with a ranged attack does not reveal your position, and dim light does not impose disadvantage on your Perception checks that rely on sight."
  },
  {
    "id": "spell_sniper",
    "name": "Spell Sniper",
    "prerequisite": "The ability to cast at least one spell",
    "text": "The range of your attack-roll spells doubles, they ignore half and three-quarters cover, and you learn one attack cantrip from the bard, cleric, druid, sorcerer, warlock or wizard list."
  },
  {
    "id": "tavern_brawler",
    "name": "Tavern Brawler",
    "prerequisite": "",
    "text": "Increase your Strength or Constitution by 1, to a maximum of 20. You are proficient with improvised weapons, your unarmed strike deals 1d4 damage, and when you hit with an unarmed strike or improvised weapon you can use a bonus action to try to grapple."
  },
  {
    "id": "tough",
    "name": "Tough",
    "prerequisite": "",
    "text": "Your hit point maximum increases by twice your level, and by 2 more each time you gain a level."
  },
  {
    "id": "war_caster",
    "name": "War Caster",
    "prerequisite": "The ability to cast at least one spell",
    "text": "You have advantage on Constitution saves to maintain concentration, you can cast with somatic components while holding weapons or a shield, and you can cast a one-action spell targeting one creature as an opportunity attack."
  },
  {
    "id": "weapon_master",
    "name": "Weapon Master",
    "prerequisite": "",
    "text": "Increase your Strength or Dexterity by 1, to a maximum of 20, and gain proficiency with four weapons of your choice."
  },
  {
    "id": "fey_touched",
    "name": "Fey Touched",
    "prerequisite": "",
    "text": "Increase your Intelligence, Wisdom or Charisma by 1, to a maximum of 20. You learn misty step and one 1st-level divination or enchantment spell, each castable once per long rest without a slot as well as with slots."
  },
  {
    "id": "shadow_touched",
    "name": "Shadow Touched",
    "prerequisite": "",
    "text": "Increase your Intelligence, Wisdom or Charisma by 1, to a maximum of 20. You learn invisibility and one 1st-level illusion or necromancy spell, each castable once per long rest without a slot as well as with slots."
  },
  {
    "id": "telekinetic",
    "name": "Telekinetic",
    "prerequisite": "",
    "text": "Increase your Intelligence, Wisdom or Charisma by 1, to a maximum of 20. You learn mage hand and can cast it without components at 30 extra feet, and as a bonus action you can shove a creature within 30 feet 5 feet on a failed Strength save."
  },
  {
    "id": "telepathic",
    "name": "Telepathic",
    "prerequisite": "",
    "text": "Increase your Intelligence, Wisdom or Charisma by 1, to a maximum of 20. You can speak telepathically to any creature within 60 feet that shares a language with you, and you can cast detect thoughts once per long rest without a slot."
  },
  {
    "id": "eldritch_adept",
    "name": "Eldritch Adept",
    "prerequisite": "Spellcasting or Pact Magic",
    "text": "You learn one Eldritch Invocation of your choice whose prerequisites you meet. You can replace it when you gain a level."
  },
  {
    "id": "metamagic_adept",
    "name": "Metamagic Adept",
    "prerequisite": "Spellcasting or Pact Magic",
    "text": "You learn two Metamagic options from the sorcerer list and gain 2 sorcery points to spend on them, refilled on a long rest."
  },
  {
    "id": "skill_expert",
    "name": "Skill Expert",
    "prerequisite": "",
    "text": "Increase one ability score by 1, to a maximum of 20. You gain proficiency in one skill, and expertise in one skill you are already proficient in."
  },
  {
    "id": "chef",
    "name": "Chef",
    "prerequisite": "",
    "text": "Increase your Constitution or Wisdom by 1, to a maximum of 20, and gain proficiency with cook's utensils. Cooking during a short rest lets allies regain an extra 1d8 hit points, and an hour's work makes treats that grant temporary hit points."
  },
  {
    "id": "crusher",
    "name": "Crusher",
    "prerequisite": "",
    "text": "Increase your Strength or Constitution by 1, to a maximum of 20. Once per turn when you deal bludgeoning damage you can move the creature 5 feet, and a critical hit with bludgeoning damage gives attackers advantage against it until your next turn."
  },
  {
    "id": "piercer",
    "name": "Piercer",
    "prerequisite": "",
    "text": "Increase your Strength or Dexterity by 1, to a maximum of 20. Once per turn when you deal piercing damage you can reroll one damage die, and a critical hit with piercing damage adds one extra damage die."
  },
  {
    "id": "slasher",
    "name": "Slasher",
    "prerequisite": "",
    "text": "Increase your Strength or Dexterity by 1, to a maximum of 20. Once per turn when you deal slashing damage you can reduce the target's speed by 10 feet, and a critical hit with slashing damage gives it disadvantage on attack rolls until your next turn."
  },
  {
    "id": "poisoner",
    "name": "Poisoner",
    "prerequisite": "",
    "text": "You ignore resistance to poison damage, you can coat a weapon as a bonus action so its next hit forces a DC 14 Constitution save for 2d8 poison damage and the poisoned condition, and you gain proficiency with the poisoner's kit."
  },
  {
    "id": "gunner",
    "name": "Gunner",
    "prerequisite": "",
    "text": "Increase your Dexterity by 1, to a maximum of 20. You gain proficiency with firearms, ignore their loading property, and being within 5 feet of a hostile creature gives you no disadvantage on ranged attacks."
  },
  {
    "id": "alert",
    "name": "Alert",
    "prerequisite": "",
    "text": "Your guard never quite drops. Add 5 to every initiative roll you make. While you are conscious no ambush catches you off guard, and an attacker hidden from your sight gets no advantage against you merely because you cannot see it."
  },
  {
    "id": "skilled",
    "name": "Skilled",
    "prerequisite": "",
    "text": "Pick any three skills or tools, in any combination, and gain proficiency with each. This feat raises no ability score."
  }
];
