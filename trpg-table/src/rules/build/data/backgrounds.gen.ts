// 自动生成：node src/rules/build/data/gen/generate.mjs
// 来源：Open Dungeon Master（MIT，Copyright (c) 2026 Jacob Ferrari, Kaleb Lutterman），提交 df3fec7，data/srd/backgrounds.json（SRD 5.1 的 13 个背景）
// 说明文字是 ODM 用自己的话写的 2014 机制复述（非 SRD 原文）。见 ../NOTICE.md。不要手改。
import type { BackgroundDef } from './schema.js';

export const BACKGROUND_DEFS: BackgroundDef[] = [
  {
    "id": "acolyte",
    "name": "Acolyte",
    "skills": [
      "insight",
      "religion"
    ],
    "tools": [],
    "languages": 2,
    "equipment": [
      "holy symbol",
      "prayer book",
      "5 sticks of incense",
      "vestments",
      "common clothes",
      "15 gp"
    ],
    "feature": "Shelter of the Faithful",
    "featureText": "As a servant of your faith, you and your companions can expect free healing and care at any temple, shrine or other establishment of your religion, though you must provide the material components for spells. Its priests will support you in ways that do not risk their lives, and you may have ties to one temple in particular.",
    "blurb": "You served in a temple, learning its rites and its politics, and the faithful still owe you shelter."
  },
  {
    "id": "charlatan",
    "name": "Charlatan",
    "skills": [
      "deception",
      "sleight_of_hand"
    ],
    "tools": [
      "disguise kit",
      "forgery kit"
    ],
    "languages": 0,
    "equipment": [
      "fine clothes",
      "disguise kit",
      "con tools",
      "15 gp"
    ],
    "feature": "False Identity",
    "featureText": "You have a second identity with documents, established acquaintances and disguises to match. You can also forge documents, including official papers and personal letters, as long as you have seen an example of the kind you are trying to copy.",
    "blurb": "You lived by your wits and a hundred false faces, and you always have another identity ready."
  },
  {
    "id": "criminal",
    "name": "Criminal",
    "skills": [
      "deception",
      "stealth"
    ],
    "tools": [
      "thieves' tools",
      "one gaming set"
    ],
    "languages": 0,
    "equipment": [
      "crowbar",
      "dark common clothes with hood",
      "15 gp"
    ],
    "feature": "Criminal Contact",
    "featureText": "You have a reliable and trustworthy contact in the criminal underworld. You know how to get messages to and from them, even over great distances, through the local messengers, corrupt caravan masters and seedy sailors who carry them.",
    "blurb": "You made your living breaking the law, and you still know who to call in the underworld."
  },
  {
    "id": "entertainer",
    "name": "Entertainer",
    "skills": [
      "acrobatics",
      "performance"
    ],
    "tools": [
      "disguise kit",
      "one musical instrument"
    ],
    "languages": 0,
    "equipment": [
      "musical instrument",
      "costume",
      "favor of an admirer",
      "15 gp"
    ],
    "feature": "By Popular Demand",
    "featureText": "You can always find a place to perform, usually an inn or tavern but sometimes a circus, a theater or a noble's court. In return you receive free lodging and food of a modest standard for as long as you perform each night, and your performance makes you a local figure whom strangers tend to like.",
    "blurb": "You performed for crowds and courts, and any tavern will trade a bed for a show."
  },
  {
    "id": "folk_hero",
    "name": "Folk Hero",
    "skills": [
      "animal_handling",
      "survival"
    ],
    "tools": [
      "one artisan's tools",
      "vehicles (land)"
    ],
    "languages": 0,
    "equipment": [
      "artisan's tools",
      "shovel",
      "iron pot",
      "common clothes",
      "10 gp"
    ],
    "feature": "Rustic Hospitality",
    "featureText": "Since you come from the ranks of the common folk, you fit in among them with ease. You can find a place to hide, rest or recuperate among other commoners unless you have shown yourself to be a danger to them. They will shield you from the law or anyone else searching for you, though they will not risk their lives for you.",
    "blurb": "You stood up for the common folk when it mattered, and they remember."
  },
  {
    "id": "guild_artisan",
    "name": "Guild Artisan",
    "skills": [
      "insight",
      "persuasion"
    ],
    "tools": [
      "one artisan's tools"
    ],
    "languages": 1,
    "equipment": [
      "artisan's tools",
      "letter of introduction from your guild",
      "traveler's clothes",
      "15 gp"
    ],
    "feature": "Guild Membership",
    "featureText": "Your guild will provide you with lodging and food if necessary and pay for your funeral if needed. In some cities a guildhall offers a central place to meet other members. Guilds wield political power: if you are accused of a crime, your guild will support you if a good case can be made, and it can help you gain access to powerful people. Membership costs 5 gp a month in dues.",
    "blurb": "You are a member in good standing of a craft guild, with its workshops and its lawyers behind you."
  },
  {
    "id": "hermit",
    "name": "Hermit",
    "skills": [
      "medicine",
      "religion"
    ],
    "tools": [
      "herbalism kit"
    ],
    "languages": 1,
    "equipment": [
      "scroll case of notes",
      "winter blanket",
      "common clothes",
      "herbalism kit",
      "5 gp"
    ],
    "feature": "Discovery",
    "featureText": "The quiet seclusion of your hermitage gave you access to a unique and powerful discovery: a great truth, a hidden site, a lost fact, or a secret whose reveal could shake the powerful. Work with the DM to determine what it is and what it means for the campaign.",
    "blurb": "You lived apart from the world in seclusion, and came back with a discovery."
  },
  {
    "id": "noble",
    "name": "Noble",
    "skills": [
      "history",
      "persuasion"
    ],
    "tools": [
      "one gaming set"
    ],
    "languages": 1,
    "equipment": [
      "fine clothes",
      "signet ring",
      "scroll of pedigree",
      "25 gp"
    ],
    "feature": "Position of Privilege",
    "featureText": "Thanks to your noble birth, people are inclined to think the best of you. You are welcome in high society, and people assume you have the right to be wherever you are. The common folk make every effort to accommodate you, other people of high birth treat you as a member of the same social sphere, and you can secure an audience with a local noble if you need to.",
    "blurb": "You were born to rank and privilege, and doors open for you that stay shut to others."
  },
  {
    "id": "outlander",
    "name": "Outlander",
    "skills": [
      "athletics",
      "survival"
    ],
    "tools": [
      "one musical instrument"
    ],
    "languages": 1,
    "equipment": [
      "staff",
      "hunting trap",
      "trophy from an animal you killed",
      "traveler's clothes",
      "10 gp"
    ],
    "feature": "Wanderer",
    "featureText": "You have an excellent memory for maps and geography, and you can always recall the general layout of terrain, settlements and other features around you. In addition, you can find food and fresh water for yourself and up to five other people each day, provided the land offers berries, small game, water and so forth.",
    "blurb": "You grew up in the wilds far from civilization, and the land still feeds you."
  },
  {
    "id": "sage",
    "name": "Sage",
    "skills": [
      "arcana",
      "history"
    ],
    "tools": [],
    "languages": 2,
    "equipment": [
      "bottle of black ink",
      "quill",
      "small knife",
      "letter from a dead colleague",
      "common clothes",
      "10 gp"
    ],
    "feature": "Researcher",
    "featureText": "When you attempt to learn or recall a piece of lore, if you do not know it, you often know where and from whom you can obtain it: a library, scriptorium, university, a sage or another learned person or creature. The DM might rule that the knowledge is secret or found only in a hard to reach place.",
    "blurb": "You spent years among books and scholars, and you know where every answer is kept."
  },
  {
    "id": "sailor",
    "name": "Sailor",
    "skills": [
      "athletics",
      "perception"
    ],
    "tools": [
      "navigator's tools",
      "vehicles (water)"
    ],
    "languages": 0,
    "equipment": [
      "belaying pin (club)",
      "50 ft silk rope",
      "lucky charm",
      "common clothes",
      "10 gp"
    ],
    "feature": "Ship's Passage",
    "featureText": "When you need to, you can secure free passage on a sailing ship for yourself and your companions. You might sail on the ship you served on or another you have good relations with. Because you are calling in a favor, the ship's schedule and route cannot be guaranteed, and you and your companions are expected to help the crew during the voyage.",
    "blurb": "You worked the decks of a ship, and captains will take you and your friends aboard for a hand's work."
  },
  {
    "id": "soldier",
    "name": "Soldier",
    "skills": [
      "athletics",
      "intimidation"
    ],
    "tools": [
      "one gaming set",
      "vehicles (land)"
    ],
    "languages": 0,
    "equipment": [
      "insignia of rank",
      "trophy from a fallen enemy",
      "gaming set",
      "common clothes",
      "10 gp"
    ],
    "feature": "Military Rank",
    "featureText": "You have a military rank from your career as a soldier. Soldiers loyal to your former organization still recognize your authority and influence, and they defer to you if they are of a lower rank. You can invoke your rank to exert influence over other soldiers and requisition simple equipment or horses for temporary use, and you can usually gain access to friendly military encampments and fortresses where your rank is recognized.",
    "blurb": "You served in an army, and those who served with you still recognize your rank."
  },
  {
    "id": "urchin",
    "name": "Urchin",
    "skills": [
      "sleight_of_hand",
      "stealth"
    ],
    "tools": [
      "disguise kit",
      "thieves' tools"
    ],
    "languages": 0,
    "equipment": [
      "small knife",
      "map of your home city",
      "pet mouse",
      "token of your parents",
      "common clothes",
      "10 gp"
    ],
    "feature": "City Secrets",
    "featureText": "You know the secret patterns and flow to cities and can find passages through the urban sprawl that others would miss. When you are not in combat, you and companions you lead can travel between any two locations in a city twice as fast as your speed would normally allow.",
    "blurb": "You grew up alone on the streets, and you know the city's hidden ways better than anyone."
  }
];
