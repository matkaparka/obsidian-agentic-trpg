// 自动生成：node src/rules/build/data/gen/generate.mjs
// 来源：Open Dungeon Master（MIT，Copyright (c) 2026 Jacob Ferrari, Kaleb Lutterman），提交 df3fec7，data/srd/subclasses.json
// 说明文字是 ODM 用自己的话写的 2014 机制复述（非 SRD 原文）。见 ../NOTICE.md。不要手改。
import type { SubclassDef } from './schema.js';

/** ODM 复述的 2014 子职业（不含 SRD 里有的那 12 个，那些手写在 srd-subclasses.ts）。 */
export const ODM_SUBCLASSES: SubclassDef[] = [
  {
    "id": "totem_warrior",
    "classId": "barbarian",
    "name": "Path of the Totem Warrior",
    "source": "odm",
    "aliases": [
      "totem warrior",
      "path-of-the-totem-warrior"
    ],
    "desc": "A barbarian who takes a beast as a spirit guide, borrowing its strengths in and out of a rage.",
    "features": {
      "3": [
        {
          "name": "Spirit Seeker",
          "text": "Ritual casting of beast sense and speak with animals."
        },
        {
          "name": "Totem Spirit",
          "text": "Choose a totem: Bear gives resistance to all damage but psychic while raging, Eagle gives a Dash bonus action and no opportunity-attack advantage against you, Wolf gives allies advantage on melee attacks against enemies within 5 feet of you."
        }
      ],
      "6": [
        {
          "name": "Aspect of the Beast",
          "text": "A permanent boon from the totem: Bear doubles carrying capacity and gives advantage on Strength checks to push, pull, lift or break, Eagle grants sight to 1 mile and no disadvantage on Perception in dim light, Wolf lets you track at a fast pace and move stealthily at a normal pace."
        }
      ],
      "10": [
        {
          "name": "Spirit Walker",
          "text": "Cast commune with nature as a ritual; the answer arrives as a spirit beast."
        }
      ],
      "14": [
        {
          "name": "Totemic Attunement",
          "text": "While raging: Bear makes enemies within 5 feet suffer disadvantage attacking anyone but you, Eagle grants flight equal to your walking speed for a turn at a time, Wolf lets a bonus action knock a Large or smaller creature prone when you hit it."
        }
      ]
    }
  },
  {
    "id": "ancestral_guardian",
    "classId": "barbarian",
    "name": "Path of the Ancestral Guardian",
    "source": "odm",
    "aliases": [
      "ancestral guardian",
      "path-of-the-ancestral-guardian"
    ],
    "desc": "Ancestral spirits answer this barbarian's rage and shield the people fighting beside them.",
    "features": {
      "3": [
        {
          "name": "Ancestral Protectors",
          "text": "While raging, the first creature you hit each turn has disadvantage on attacks against anyone but you, and its damage against others is halved until your next turn."
        }
      ],
      "6": [
        {
          "name": "Spirit Shield",
          "text": "While raging, a reaction reduces damage to an ally you can see within 30 feet by 2d6, rising to 3d6 at 10th level and 4d6 at 14th."
        }
      ],
      "10": [
        {
          "name": "Consult the Spirits",
          "text": "Cast augury or clairvoyance once per short or long rest, using Wisdom, without a slot or components."
        }
      ],
      "14": [
        {
          "name": "Vengeful Ancestors",
          "text": "Damage prevented by Spirit Shield is dealt straight back to the attacker as force damage."
        }
      ]
    }
  },
  {
    "id": "storm_herald",
    "classId": "barbarian",
    "name": "Path of the Storm Herald",
    "source": "odm",
    "aliases": [
      "storm herald",
      "path-of-the-storm-herald"
    ],
    "desc": "Rage manifests as a 10-foot aura of desert heat, arctic cold, or sea storm.",
    "features": {
      "3": [
        {
          "name": "Storm Aura",
          "text": "A 10-foot aura while raging, activated as a bonus action: Desert deals 2 fire damage to every other creature in it, Sea forces one creature you pick to make a Dexterity save or take 1d6 lightning, Tundra grants every ally in it 2 temporary hit points. Damage and hit points scale with barbarian level."
        }
      ],
      "6": [
        {
          "name": "Storm Soul",
          "text": "Resistance to your aura's damage type and a matching boon: Desert gives fire resistance and heat protection, Sea gives lightning resistance, swim speed and water breathing, Tundra gives cold resistance and lets you freeze 5 feet of water."
        }
      ],
      "10": [
        {
          "name": "Shielding Storm",
          "text": "Every ally inside your Storm Aura shares your Storm Soul damage resistance."
        }
      ],
      "14": [
        {
          "name": "Raging Storm",
          "text": "Your aura gains a rider once per turn: Desert deals fire damage to a creature that hits you, Sea knocks a creature prone on a failed Strength save, Tundra halves a creature's speed on a failed Strength save."
        }
      ]
    }
  },
  {
    "id": "zealot",
    "classId": "barbarian",
    "name": "Path of the Zealot",
    "source": "odm",
    "aliases": [
      "zealot",
      "path-of-the-zealot"
    ],
    "desc": "A divine champion whose fury is holy, and who death itself has trouble keeping.",
    "features": {
      "3": [
        {
          "name": "Divine Fury",
          "text": "The first creature you hit each turn while raging takes an extra 1d6 + half your barbarian level radiant or necrotic damage."
        },
        {
          "name": "Warrior of the Gods",
          "text": "A spell that restores you to life needs no material component."
        }
      ],
      "6": [
        {
          "name": "Fanatical Focus",
          "text": "Once per rage, reroll a failed saving throw and use the new result."
        }
      ],
      "10": [
        {
          "name": "Zealous Presence",
          "text": "A bonus action, once per long rest, grants up to ten allies within 60 feet advantage on attacks and saves until your next turn."
        }
      ],
      "14": [
        {
          "name": "Rage Beyond Death",
          "text": "While raging, dropping to 0 hit points does not knock you out; you fight on and only die if the rage ends while you are still at 0."
        }
      ]
    }
  },
  {
    "id": "beast",
    "classId": "barbarian",
    "name": "Path of the Beast",
    "source": "odm",
    "aliases": [
      "beast",
      "path-of-the-beast"
    ],
    "desc": "Rage grows weapons out of the barbarian's own body: claws, a tail, savage teeth.",
    "features": {
      "3": [
        {
          "name": "Form of the Beast",
          "text": "When you rage, grow a natural weapon until the rage ends: Bite deals 1d8 piercing and heals you when you are below half hit points, Claws deal 1d6 slashing and grant an extra attack with them, Tail deals 1d8 piercing with 10-foot reach and adds to AC as a reaction."
        }
      ],
      "6": [
        {
          "name": "Bestial Soul",
          "text": "Your natural weapons count as magical, and you can adapt to swim, climb or jump after each rest."
        }
      ],
      "10": [
        {
          "name": "Infectious Fury",
          "text": "A proficiency-bonus number of times per long rest, a natural-weapon hit forces a Wisdom save: the target either attacks a creature of your choice or takes 2d12 psychic damage."
        }
      ],
      "14": [
        {
          "name": "Call the Hunt",
          "text": "A proficiency-bonus number of times per long rest, when you enter your rage, grant up to five allies an extra d6 of damage on one hit per turn, and gain 5 temporary hit points for each ally who accepts."
        }
      ]
    }
  },
  {
    "id": "wild_magic",
    "classId": "barbarian",
    "name": "Path of Wild Magic",
    "source": "odm",
    "aliases": [
      "wild magic barbarian",
      "path-of-wild-magic"
    ],
    "desc": "Raw magic leaks out of this barbarian every time their temper does.",
    "features": {
      "3": [
        {
          "name": "Magic Awareness",
          "text": "As an action, sense spells and magic items within 60 feet, a number of times per long rest equal to your proficiency bonus."
        },
        {
          "name": "Wild Surge",
          "text": "Roll on your wild magic table each time you rage; the rolled effect lasts as long as the rage."
        }
      ],
      "6": [
        {
          "name": "Bolstering Magic",
          "text": "A proficiency-bonus number of times per long rest, touch an ally to grant a bonus d3 on attacks and ability checks for 10 minutes, or restore one expended spell slot of 3rd level or lower."
        }
      ],
      "10": [
        {
          "name": "Unstable Backlash",
          "text": "When you take damage or fail a save while raging, a reaction rerolls your Wild Surge effect."
        }
      ],
      "14": [
        {
          "name": "Controlled Surge",
          "text": "Roll twice on the wild magic table and choose which result takes hold."
        }
      ]
    }
  },
  {
    "id": "giant",
    "classId": "barbarian",
    "name": "Path of the Giant",
    "source": "odm",
    "aliases": [
      "giant",
      "path-of-the-giant"
    ],
    "desc": "A barbarian who channels giantkind, growing to their size and hurling what comes to hand.",
    "features": {
      "3": [
        {
          "name": "Giant's Power",
          "text": "Learn Giant and the druidcraft cantrip."
        },
        {
          "name": "Elemental Cleaver",
          "text": "While raging, one weapon deals your chosen elemental damage instead of its own type and gains the thrown property with a 20/60 range, returning to your hand each throw."
        }
      ],
      "6": [
        {
          "name": "Mighty Impel",
          "text": "As a bonus action while raging, move a Large or smaller creature within 10 feet up to 30 feet through the air; an unwilling one gets a Strength save."
        }
      ],
      "10": [
        {
          "name": "Demiurgic Colossus",
          "text": "While raging you grow to Large, your reach grows by 5 feet, Elemental Cleaver's throw range doubles and its damage grows by 1d10."
        }
      ],
      "14": [
        {
          "name": "Elemental Fury",
          "text": "Once per turn while raging, add your rage damage to an Elemental Cleaver hit again, or force a Constitution save on a creature within 10 feet for 3d8 of your element."
        }
      ]
    }
  },
  {
    "id": "valor",
    "classId": "bard",
    "name": "College of Valor",
    "source": "odm",
    "aliases": [
      "valor",
      "college-of-valor"
    ],
    "desc": "A battle-skald who fights in the front rank and turns the fight itself into the song.",
    "features": {
      "3": [
        {
          "name": "Bonus Proficiencies (Valor)",
          "text": "Proficiency with medium armor, shields and martial weapons."
        },
        {
          "name": "Combat Inspiration",
          "text": "A creature holding your Bardic Inspiration die may add it to a damage roll, or use a reaction to add it to AC against one attack."
        }
      ],
      "6": [
        {
          "name": "Extra Attack",
          "text": "Attack twice when you take the Attack action."
        }
      ],
      "14": [
        {
          "name": "Battle Magic",
          "text": "After casting a spell with an action, a bonus action makes one weapon attack."
        }
      ]
    }
  },
  {
    "id": "glamour",
    "classId": "bard",
    "name": "College of Glamour",
    "source": "odm",
    "aliases": [
      "glamour",
      "college-of-glamour"
    ],
    "desc": "Feywild-touched charm: this bard rescues allies with a word and commands rooms on presence alone.",
    "features": {
      "3": [
        {
          "name": "Mantle of Inspiration",
          "text": "A bonus action spends a Bardic Inspiration to give allies within 60 feet temporary hit points and an immediate reaction-free move."
        },
        {
          "name": "Enthralling Performance",
          "text": "After a minute of performance, charm up to a proficiency-bonus number of humanoids that fail a Wisdom save; once per short or long rest."
        }
      ],
      "6": [
        {
          "name": "Mantle of Majesty",
          "text": "Cast command as a bonus action for a minute without a slot, with listeners charmed against retaliating; once per long rest."
        }
      ],
      "14": [
        {
          "name": "Unbreakable Majesty",
          "text": "A bonus action makes you awesome to behold for a minute: an attacker must pass a Charisma save or lose the attack and be unable to target you that turn."
        }
      ]
    }
  },
  {
    "id": "swords",
    "classId": "bard",
    "name": "College of Swords",
    "source": "odm",
    "aliases": [
      "swords",
      "college-of-swords",
      "blade"
    ],
    "desc": "A blade-dancing performer whose weapon flourishes are the performance.",
    "features": {
      "3": [
        {
          "name": "Bonus Proficiencies (Swords)",
          "text": "Proficiency with medium armor and the scimitar; your weapon can serve as a spellcasting focus."
        },
        {
          "name": "Fighting Style (Blade)",
          "text": "Choose the Dueling or Two-Weapon Fighting style."
        },
        {
          "name": "Blade Flourish",
          "text": "Your speed rises by 10 feet on any turn you take the Attack action, and once per turn you may spend a Bardic Inspiration die on a Defensive, Slashing or Mobile flourish."
        }
      ],
      "6": [
        {
          "name": "Extra Attack",
          "text": "Attack twice when you take the Attack action."
        }
      ],
      "14": [
        {
          "name": "Master's Flourish",
          "text": "Roll a d6 for a flourish instead of spending a Bardic Inspiration die."
        }
      ]
    }
  },
  {
    "id": "whispers",
    "classId": "bard",
    "name": "College of Whispers",
    "source": "odm",
    "aliases": [
      "whispers",
      "college-of-whispers"
    ],
    "desc": "A bard who trades in fear and secrets and wears other people's lives like costumes.",
    "features": {
      "3": [
        {
          "name": "Psychic Blades",
          "text": "Spend a Bardic Inspiration die on a weapon hit for extra psychic damage, 2d6 at 3rd level and rising with bard level."
        },
        {
          "name": "Words of Terror",
          "text": "A minute of private conversation frightens a humanoid of you or someone you name for an hour on a failed Wisdom save; once per short or long rest."
        }
      ],
      "6": [
        {
          "name": "Mantle of Whispers",
          "text": "A reaction captures the shadow of a humanoid that just died, letting you wear their identity for an hour; once per short or long rest."
        }
      ],
      "14": [
        {
          "name": "Shadow Lore",
          "text": "Whisper a creature's darkest secret: on a failed Wisdom save it is charmed and obeys your requests for 8 hours; once per long rest."
        }
      ]
    }
  },
  {
    "id": "eloquence",
    "classId": "bard",
    "name": "College of Eloquence",
    "source": "odm",
    "aliases": [
      "eloquence",
      "college-of-eloquence"
    ],
    "desc": "A rhetorician who never misses with a word and never wastes an inspiration die.",
    "features": {
      "3": [
        {
          "name": "Silver Tongue",
          "text": "Treat any d20 of 9 or lower as a 10 on Persuasion and Deception checks."
        },
        {
          "name": "Unsettling Words",
          "text": "A bonus action spends a Bardic Inspiration die to subtract it from one creature's next saving throw."
        }
      ],
      "6": [
        {
          "name": "Unfailing Inspiration",
          "text": "An inspiration die that fails to change the outcome is not spent."
        }
      ],
      "14": [
        {
          "name": "Infectious Inspiration",
          "text": "A reaction copies a successful inspiration die onto another creature, a Charisma-modifier number of times per long rest."
        }
      ]
    }
  },
  {
    "id": "creation",
    "classId": "bard",
    "name": "College of Creation",
    "source": "odm",
    "aliases": [
      "creation",
      "college-of-creation"
    ],
    "desc": "The Song of Creation still echoes, and this bard can sing objects and dancing things into being.",
    "features": {
      "3": [
        {
          "name": "Mote of Potential",
          "text": "Your Bardic Inspiration also produces a mote whose burst helps the holder: extra damage on an attack, temporary hit points on a check, or an ally bonus on a save."
        },
        {
          "name": "Performance of Creation",
          "text": "Create a nonmagical item worth no more than 20 times your bard level as an action, once per long rest or with a spell slot."
        }
      ],
      "6": [
        {
          "name": "Animating Performance",
          "text": "Animate a Large or smaller object as a dancing companion that acts on your turn and can make a thunderous Strength attack; once per long rest or with a spell slot."
        }
      ],
      "14": [
        {
          "name": "Creative Crescendo",
          "text": "Performance of Creation makes several items at once and drops the cost limit on all but the largest."
        }
      ]
    }
  },
  {
    "id": "spirits",
    "classId": "bard",
    "name": "College of Spirits",
    "source": "odm",
    "aliases": [
      "spirits",
      "college-of-spirits"
    ],
    "desc": "A medium who calls up stories from the dead and lets the tale decide what happens next.",
    "features": {
      "3": [
        {
          "name": "Guiding Whispers",
          "text": "You know guidance and can cast it at 60 feet."
        },
        {
          "name": "Spiritual Focus",
          "text": "A candle, a deck, a talking board or the like serves as your spellcasting focus and adds a die to the damage or healing of your bard spells at higher levels."
        },
        {
          "name": "Tales from Beyond",
          "text": "Spend a Bardic Inspiration die and roll on a table of spirit tales, each with its own effect you can release on a target."
        }
      ],
      "6": [
        {
          "name": "Spirit Session",
          "text": "An hour-long seance with allies lets you learn one divination or necromancy spell of a level up to the ritual's length and cast it until your next long rest."
        }
      ],
      "14": [
        {
          "name": "Mystical Connection",
          "text": "Reroll an unwanted Tales from Beyond result, and roll for it without spending a die once per short rest."
        }
      ]
    }
  },
  {
    "id": "knowledge_domain",
    "classId": "cleric",
    "name": "Knowledge Domain",
    "source": "odm",
    "aliases": [
      "knowledge",
      "knowledge-domain"
    ],
    "desc": "A cleric of the gods of learning, for whom every secret is a form of power.",
    "features": {
      "1": [
        {
          "name": "Blessings of Knowledge",
          "text": "Two extra languages, and proficiency plus expertise in two of Arcana, History, Nature and Religion."
        }
      ],
      "2": [
        {
          "name": "Channel Divinity: Knowledge of the Ages",
          "text": "Gain proficiency with one skill or tool of your choice for 10 minutes."
        }
      ],
      "6": [
        {
          "name": "Channel Divinity: Read Thoughts",
          "text": "Read a creature's surface thoughts for a minute and cast suggestion on it without a slot."
        }
      ],
      "8": [
        {
          "name": "Potent Spellcasting",
          "text": "Add your Wisdom modifier to the damage of your cleric cantrips."
        }
      ],
      "17": [
        {
          "name": "Visions of the Past",
          "text": "A minute of concentration reveals an object's or a place's recent history."
        }
      ]
    },
    "spells": {
      "1": [
        "command",
        "identify"
      ],
      "3": [
        "augury",
        "suggestion"
      ],
      "5": [
        "nondetection",
        "speak_with_dead"
      ],
      "7": [
        "arcane_eye",
        "confusion"
      ],
      "9": [
        "legend_lore",
        "scrying"
      ]
    }
  },
  {
    "id": "light_domain",
    "classId": "cleric",
    "name": "Light Domain",
    "source": "odm",
    "aliases": [
      "light",
      "light-domain"
    ],
    "desc": "A cleric of sun and flame who burns away darkness and the things that hide in it.",
    "features": {
      "1": [
        {
          "name": "Bonus Cantrip (Light)",
          "text": "You know the light cantrip."
        },
        {
          "name": "Warding Flare",
          "text": "A reaction imposes disadvantage on an attack against you, a Wisdom-modifier number of times per long rest."
        }
      ],
      "2": [
        {
          "name": "Channel Divinity: Radiance of the Dawn",
          "text": "Dispel magical darkness within 30 feet and deal 2d10 + cleric level radiant damage to hostile creatures, halved on a Constitution save."
        }
      ],
      "6": [
        {
          "name": "Improved Warding Flare",
          "text": "Warding Flare also protects an ally you can see within 30 feet."
        }
      ],
      "8": [
        {
          "name": "Potent Spellcasting",
          "text": "Add your Wisdom modifier to the damage of your cleric cantrips."
        }
      ],
      "17": [
        {
          "name": "Corona of Light",
          "text": "For a minute, shed 60 feet of bright light and give enemies in it disadvantage on saves against fire and radiant spells."
        }
      ]
    },
    "spells": {
      "1": [
        "burning_hands",
        "faerie_fire"
      ],
      "3": [
        "flaming_sphere",
        "scorching_ray"
      ],
      "5": [
        "daylight",
        "fireball"
      ],
      "7": [
        "guardian_of_faith",
        "wall_of_fire"
      ],
      "9": [
        "flame_strike",
        "scrying"
      ]
    }
  },
  {
    "id": "nature_domain",
    "classId": "cleric",
    "name": "Nature Domain",
    "source": "odm",
    "aliases": [
      "nature",
      "nature-domain"
    ],
    "desc": "A priest of the wild gods, as at home with beasts and weather as with prayer.",
    "features": {
      "1": [
        {
          "name": "Acolyte of Nature",
          "text": "One druid cantrip and proficiency in Animal Handling, Nature or Survival."
        },
        {
          "name": "Bonus Proficiency (heavy armor)",
          "text": "Proficiency with heavy armor."
        }
      ],
      "2": [
        {
          "name": "Channel Divinity: Charm Animals and Plants",
          "text": "Beasts and plants within 30 feet that fail a Wisdom save are charmed for a minute and friendly to you and your allies."
        }
      ],
      "6": [
        {
          "name": "Dampen Elements",
          "text": "A reaction grants you or an ally within 30 feet resistance to one instance of acid, cold, fire, lightning or thunder damage."
        }
      ],
      "8": [
        {
          "name": "Divine Strike",
          "text": "Once per turn a weapon hit deals an extra 1d8 cold, fire or lightning damage, rising to 2d8 at 14th level."
        }
      ],
      "17": [
        {
          "name": "Master of Nature",
          "text": "A bonus action commands creatures charmed by your Channel Divinity."
        }
      ]
    },
    "spells": {
      "1": [
        "animal_friendship",
        "speak_with_animals"
      ],
      "3": [
        "barkskin",
        "spike_growth"
      ],
      "5": [
        "plant_growth",
        "wind_wall"
      ],
      "7": [
        "dominate_beast",
        "grasping_vine"
      ],
      "9": [
        "insect_plague",
        "tree_stride"
      ]
    }
  },
  {
    "id": "tempest_domain",
    "classId": "cleric",
    "name": "Tempest Domain",
    "source": "odm",
    "aliases": [
      "tempest",
      "tempest-domain"
    ],
    "desc": "Thunder and lightning made doctrine: this cleric answers insult with a storm.",
    "features": {
      "1": [
        {
          "name": "Bonus Proficiencies (Tempest)",
          "text": "Proficiency with martial weapons and heavy armor."
        },
        {
          "name": "Wrath of the Storm",
          "text": "A reaction deals 2d8 lightning or thunder damage to a creature that hits you in melee, halved on a Dexterity save; a Wisdom-modifier number of times per long rest."
        }
      ],
      "2": [
        {
          "name": "Channel Divinity: Destructive Wrath",
          "text": "Deal maximum damage instead of rolling for lightning or thunder damage."
        }
      ],
      "6": [
        {
          "name": "Thunderbolt Strike",
          "text": "Lightning damage you deal pushes a Large or smaller creature 10 feet away."
        }
      ],
      "8": [
        {
          "name": "Divine Strike",
          "text": "Once per turn a weapon hit deals an extra 1d8 thunder damage, rising to 2d8 at 14th level."
        }
      ],
      "17": [
        {
          "name": "Stormborn",
          "text": "You have a flying speed equal to your walking speed while not underground or indoors."
        }
      ]
    },
    "spells": {
      "1": [
        "fog_cloud",
        "thunderwave"
      ],
      "3": [
        "gust_of_wind",
        "shatter"
      ],
      "5": [
        "call_lightning",
        "sleet_storm"
      ],
      "7": [
        "control_water",
        "ice_storm"
      ],
      "9": [
        "destructive_wave",
        "insect_plague"
      ]
    }
  },
  {
    "id": "trickery_domain",
    "classId": "cleric",
    "name": "Trickery Domain",
    "source": "odm",
    "aliases": [
      "trickery",
      "trickery-domain"
    ],
    "desc": "A holy trickster whose blessings are disguises, duplicates and well-aimed mischief.",
    "features": {
      "1": [
        {
          "name": "Blessing of the Trickster",
          "text": "Touch a willing creature to give it advantage on Stealth checks for an hour."
        }
      ],
      "2": [
        {
          "name": "Channel Divinity: Invoke Duplicity",
          "text": "Create an illusory double for a minute that you can move, cast spells through, and use to gain attack advantage."
        }
      ],
      "6": [
        {
          "name": "Channel Divinity: Cloak of Shadows",
          "text": "Become invisible until the end of your next turn or until you attack or cast."
        }
      ],
      "8": [
        {
          "name": "Divine Strike",
          "text": "Once per turn a weapon hit deals an extra 1d8 poison damage, rising to 2d8 at 14th level."
        }
      ],
      "17": [
        {
          "name": "Improved Duplicity",
          "text": "Invoke Duplicity creates up to four illusory duplicates."
        }
      ]
    },
    "spells": {
      "1": [
        "charm_person",
        "disguise_self"
      ],
      "3": [
        "mirror_image",
        "pass_without_trace"
      ],
      "5": [
        "blink",
        "dispel_magic"
      ],
      "7": [
        "dimension_door",
        "polymorph"
      ],
      "9": [
        "dominate_person",
        "modify_memory"
      ]
    }
  },
  {
    "id": "war_domain",
    "classId": "cleric",
    "name": "War Domain",
    "source": "odm",
    "aliases": [
      "war",
      "war-domain"
    ],
    "desc": "A battle priest whose god expects the front line, not the back rank.",
    "features": {
      "1": [
        {
          "name": "Bonus Proficiencies (War)",
          "text": "Proficiency with martial weapons and heavy armor."
        },
        {
          "name": "War Priest",
          "text": "A bonus-action weapon attack when you take the Attack action, a Wisdom-modifier number of times per long rest."
        }
      ],
      "2": [
        {
          "name": "Channel Divinity: Guided Strike",
          "text": "Add +10 to one attack roll, before or after seeing the result."
        }
      ],
      "6": [
        {
          "name": "Channel Divinity: War God's Blessing",
          "text": "A reaction grants an ally within 30 feet +10 on an attack roll."
        }
      ],
      "8": [
        {
          "name": "Divine Strike",
          "text": "Once per turn a weapon hit deals an extra 1d8 damage of the weapon's type, rising to 2d8 at 14th level."
        }
      ],
      "17": [
        {
          "name": "Avatar of Battle",
          "text": "Resistance to nonmagical bludgeoning, piercing and slashing damage."
        }
      ]
    },
    "spells": {
      "1": [
        "divine_favor",
        "shield_of_faith"
      ],
      "3": [
        "magic_weapon",
        "spiritual_weapon"
      ],
      "5": [
        "crusaders_mantle",
        "spirit_guardians"
      ],
      "7": [
        "freedom_of_movement",
        "stoneskin"
      ],
      "9": [
        "flame_strike",
        "hold_monster"
      ]
    }
  },
  {
    "id": "death_domain",
    "classId": "cleric",
    "name": "Death Domain",
    "source": "odm",
    "aliases": [
      "death",
      "death-domain"
    ],
    "desc": "A cleric of the gods of endings, comfortable with necrotic power and the grave's authority.",
    "features": {
      "1": [
        {
          "name": "Bonus Proficiency (martial weapons)",
          "text": "Proficiency with martial weapons."
        },
        {
          "name": "Reaper",
          "text": "Learn a necromancy cantrip; single-target necromancy cantrips can hit a second creature within 5 feet of the first."
        }
      ],
      "2": [
        {
          "name": "Channel Divinity: Touch of Death",
          "text": "A melee hit deals extra necrotic damage equal to 5 + twice your cleric level."
        }
      ],
      "6": [
        {
          "name": "Inescapable Destruction",
          "text": "Your necrotic damage ignores resistance."
        }
      ],
      "8": [
        {
          "name": "Divine Strike",
          "text": "Once per turn a weapon hit deals an extra 1d8 necrotic damage, rising to 2d8 at 14th level."
        }
      ],
      "17": [
        {
          "name": "Improved Reaper",
          "text": "Cast a necromancy spell of 1st to 5th level that targets one creature at two creatures within 5 feet, at the cost of 1d8 of your own hit points per spell level."
        }
      ]
    },
    "spells": {
      "1": [
        "false_life",
        "ray_of_sickness"
      ],
      "3": [
        "blindness_deafness",
        "ray_of_enfeeblement"
      ],
      "5": [
        "animate_dead",
        "vampiric_touch"
      ],
      "7": [
        "blight",
        "death_ward"
      ],
      "9": [
        "antilife_shell",
        "cloudkill"
      ]
    }
  },
  {
    "id": "forge_domain",
    "classId": "cleric",
    "name": "Forge Domain",
    "source": "odm",
    "aliases": [
      "forge",
      "forge-domain"
    ],
    "desc": "A smith-priest who blesses armor and weapons and treats the anvil as an altar.",
    "features": {
      "1": [
        {
          "name": "Bonus Proficiencies (Forge)",
          "text": "Proficiency with heavy armor and smith's tools."
        },
        {
          "name": "Blessing of the Forge",
          "text": "After a long rest, enchant a weapon or suit of armor you touch with a +1 bonus until you use the feature again."
        }
      ],
      "2": [
        {
          "name": "Channel Divinity: Artisan's Blessing",
          "text": "An hour of ritual smithing creates a simple metal item worth up to 100 gp."
        }
      ],
      "6": [
        {
          "name": "Soul of the Forge",
          "text": "+1 AC while wearing heavy armor, and resistance to fire damage."
        }
      ],
      "8": [
        {
          "name": "Divine Strike",
          "text": "Once per turn a weapon hit deals an extra 1d8 fire damage, rising to 2d8 at 14th level."
        }
      ],
      "17": [
        {
          "name": "Saint of Forge and Fire",
          "text": "Immunity to fire damage, and resistance to nonmagical bludgeoning, piercing and slashing while in heavy armor."
        }
      ]
    },
    "spells": {
      "1": [
        "identify",
        "searing_smite"
      ],
      "3": [
        "heat_metal",
        "magic_weapon"
      ],
      "5": [
        "elemental_weapon",
        "protection_from_energy"
      ],
      "7": [
        "fabricate",
        "wall_of_fire"
      ],
      "9": [
        "animate_objects",
        "creation"
      ]
    }
  },
  {
    "id": "grave_domain",
    "classId": "cleric",
    "name": "Grave Domain",
    "source": "odm",
    "aliases": [
      "grave",
      "grave-domain"
    ],
    "desc": "A warden of the border between life and death who hates undeath more than dying.",
    "features": {
      "1": [
        {
          "name": "Circle of Mortality",
          "text": "Healing spells cast on a creature at 0 hit points heal the maximum; you can cast spare the dying at 30 feet as a bonus action."
        },
        {
          "name": "Eyes of the Grave",
          "text": "Detect undead within 60 feet as an action, a Wisdom-modifier number of times per long rest."
        }
      ],
      "2": [
        {
          "name": "Channel Divinity: Path to the Grave",
          "text": "Curse a creature so the next attack against it has advantage and doubles its damage vulnerability for that hit."
        }
      ],
      "6": [
        {
          "name": "Sentinel at Death's Door",
          "text": "A reaction turns a critical hit against a creature within 30 feet into a normal hit, a Wisdom-modifier number of times per long rest."
        }
      ],
      "8": [
        {
          "name": "Potent Spellcasting",
          "text": "Add your Wisdom modifier to the damage of your cleric cantrips."
        }
      ],
      "17": [
        {
          "name": "Keeper of Souls",
          "text": "Once per turn, when an enemy within 60 feet dies, an ally you can see regains hit points equal to its Hit Dice."
        }
      ]
    },
    "spells": {
      "1": [
        "bane",
        "false_life"
      ],
      "3": [
        "gentle_repose",
        "ray_of_enfeeblement"
      ],
      "5": [
        "revivify",
        "vampiric_touch"
      ],
      "7": [
        "blight",
        "death_ward"
      ],
      "9": [
        "antilife_shell",
        "raise_dead"
      ]
    }
  },
  {
    "id": "order_domain",
    "classId": "cleric",
    "name": "Order Domain",
    "source": "odm",
    "aliases": [
      "order",
      "order-domain"
    ],
    "desc": "A cleric of law and hierarchy who turns obedience into a battlefield asset.",
    "features": {
      "1": [
        {
          "name": "Bonus Proficiencies (Order)",
          "text": "Heavy armor, plus proficiency in Intimidation or Persuasion."
        },
        {
          "name": "Voice of Authority",
          "text": "After a spell of 1st level or higher targets an ally, that ally may use a reaction to make one weapon attack."
        }
      ],
      "2": [
        {
          "name": "Channel Divinity: Order's Demand",
          "text": "Creatures of your choice within 30 feet are charmed for a minute on a failed Wisdom save, and you may drop or push one of them 30 feet."
        }
      ],
      "6": [
        {
          "name": "Embodiment of the Law",
          "text": "A Wisdom-modifier number of times per long rest, cast an enchantment spell of 1st level or higher as a bonus action."
        }
      ],
      "8": [
        {
          "name": "Divine Strike",
          "text": "Once per turn a weapon hit deals an extra 1d8 psychic damage, rising to 2d8 at 14th level."
        }
      ],
      "17": [
        {
          "name": "Order's Wrath",
          "text": "Once per turn, a creature you damage with Divine Strike takes an extra 2d8 psychic damage the next time an ally hits it."
        }
      ]
    },
    "spells": {
      "1": [
        "command",
        "heroism"
      ],
      "3": [
        "hold_person",
        "zone_of_truth"
      ],
      "5": [
        "mass_healing_word",
        "slow"
      ],
      "7": [
        "compulsion",
        "locate_creature"
      ],
      "9": [
        "commune",
        "dominate_person"
      ]
    }
  },
  {
    "id": "peace_domain",
    "classId": "cleric",
    "name": "Peace Domain",
    "source": "odm",
    "aliases": [
      "peace",
      "peace-domain"
    ],
    "desc": "A binder of bonds whose blessing makes a party fight and endure as one thing.",
    "features": {
      "1": [
        {
          "name": "Implement of Peace",
          "text": "Proficiency in Performance, Insight or Persuasion."
        },
        {
          "name": "Emboldening Bond",
          "text": "Bond a proficiency-bonus number of creatures for 10 minutes; while near each other they may add a d4 to an attack, check or save, once per turn."
        }
      ],
      "2": [
        {
          "name": "Channel Divinity: Balm of Peace",
          "text": "Move without provoking and heal each creature you pass within 5 feet for 2d6 + your Wisdom modifier."
        }
      ],
      "6": [
        {
          "name": "Protective Bond",
          "text": "A bonded creature may use a reaction to teleport to another and take its damage instead."
        }
      ],
      "8": [
        {
          "name": "Potent Spellcasting",
          "text": "Add your Wisdom modifier to the damage of your cleric cantrips."
        }
      ],
      "17": [
        {
          "name": "Expansive Bond",
          "text": "Emboldening Bond's range grows to 60 feet and Protective Bond halves the damage taken."
        }
      ]
    },
    "spells": {
      "1": [
        "heroism",
        "sanctuary"
      ],
      "3": [
        "aid",
        "warding_bond"
      ],
      "5": [
        "beacon_of_hope",
        "sending"
      ],
      "7": [
        "aura_of_purity",
        "otilukes_resilient_sphere"
      ],
      "9": [
        "greater_restoration",
        "rarys_telepathic_bond"
      ]
    }
  },
  {
    "id": "twilight_domain",
    "classId": "cleric",
    "name": "Twilight Domain",
    "source": "odm",
    "aliases": [
      "twilight",
      "twilight-domain"
    ],
    "desc": "A shepherd of the border hour, granting sight in the dark and calm against terror.",
    "features": {
      "1": [
        {
          "name": "Bonus Proficiencies (Twilight)",
          "text": "Martial weapons and heavy armor."
        },
        {
          "name": "Eyes of Night",
          "text": "Darkvision out to 300 feet, shareable with a Wisdom-modifier number of creatures once per long rest."
        },
        {
          "name": "Vigilant Blessing",
          "text": "Touch a creature to give it advantage on its next initiative roll."
        }
      ],
      "2": [
        {
          "name": "Channel Divinity: Twilight Sanctuary",
          "text": "A 30-foot aura for a minute that grants each ally either temporary hit points of 1d6 + cleric level or an end to a charm or fear effect, each round."
        }
      ],
      "6": [
        {
          "name": "Steps of Night",
          "text": "A bonus action in dim light or darkness grants flight for a minute, a proficiency-bonus number of times per long rest."
        }
      ],
      "8": [
        {
          "name": "Divine Strike",
          "text": "Once per turn a weapon hit deals an extra 1d8 radiant damage, rising to 2d8 at 14th level."
        }
      ],
      "17": [
        {
          "name": "Twilight Shroud",
          "text": "Allies inside Twilight Sanctuary have half cover."
        }
      ]
    },
    "spells": {
      "1": [
        "faerie_fire",
        "sleep"
      ],
      "3": [
        "moonbeam",
        "see_invisibility"
      ],
      "5": [
        "aura_of_vitality",
        "leomunds_tiny_hut"
      ],
      "7": [
        "aura_of_life",
        "greater_invisibility"
      ],
      "9": [
        "circle_of_power",
        "mislead"
      ]
    }
  },
  {
    "id": "arcana_domain",
    "classId": "cleric",
    "name": "Arcana Domain",
    "source": "odm",
    "aliases": [
      "arcana",
      "arcana-domain"
    ],
    "desc": "A cleric of the gods of magic itself, as much a scholar of spellcraft as a priest.",
    "features": {
      "1": [
        {
          "name": "Arcane Initiate",
          "text": "Proficiency in Arcana and two wizard cantrips of your choice."
        }
      ],
      "2": [
        {
          "name": "Channel Divinity: Arcane Abjuration",
          "text": "Turn one celestial, elemental, fey or fiend within 30 feet on a failed Wisdom save, banishing weaker ones outright at higher levels."
        }
      ],
      "6": [
        {
          "name": "Spell Breaker",
          "text": "Restoring hit points with a spell also ends one spell of equal or lower level on the target."
        }
      ],
      "8": [
        {
          "name": "Potent Spellcasting",
          "text": "Add your Wisdom modifier to the damage of your cleric cantrips."
        }
      ],
      "17": [
        {
          "name": "Arcane Mastery",
          "text": "Add four wizard spells of 6th, 7th, 8th and 9th level to your cleric spell list."
        }
      ]
    },
    "spells": {
      "1": [
        "detect_magic",
        "magic_missile"
      ],
      "3": [
        "magic_weapon",
        "nystuls_magic_aura"
      ],
      "5": [
        "dispel_magic",
        "magic_circle"
      ],
      "7": [
        "arcane_eye",
        "leomunds_secret_chest"
      ],
      "9": [
        "planar_binding",
        "teleportation_circle"
      ]
    }
  },
  {
    "id": "moon",
    "classId": "druid",
    "name": "Circle of the Moon",
    "source": "odm",
    "aliases": [
      "moon",
      "circle-of-the-moon"
    ],
    "desc": "A druid who fights as a beast, shifting fast and into far more dangerous shapes than most.",
    "features": {
      "2": [
        {
          "name": "Combat Wild Shape",
          "text": "Wild Shape as a bonus action, and while transformed spend a spell slot as a bonus action to heal 1d8 per slot level."
        },
        {
          "name": "Circle Forms",
          "text": "Wild Shape into beasts of challenge rating 1 at 2nd level, and up to a third of your druid level rounded down from 6th level on."
        }
      ],
      "6": [
        {
          "name": "Primal Strike",
          "text": "Your beast form's attacks count as magical for overcoming resistance."
        }
      ],
      "10": [
        {
          "name": "Elemental Wild Shape",
          "text": "Spend two Wild Shape uses at once to become an air, earth, fire or water elemental."
        }
      ],
      "14": [
        {
          "name": "Thousand Forms",
          "text": "Cast alter self at will."
        }
      ]
    }
  },
  {
    "id": "dreams",
    "classId": "druid",
    "name": "Circle of Dreams",
    "source": "odm",
    "aliases": [
      "dreams",
      "circle-of-dreams"
    ],
    "desc": "A druid tied to the Summer Court, offering rest, safe camps and moonlit escape routes.",
    "features": {
      "2": [
        {
          "name": "Balm of the Summer Court",
          "text": "A pool of d6s equal to your druid level, spendable as a bonus action to heal a creature within 120 feet and give it temporary hit points; refills on a long rest."
        }
      ],
      "6": [
        {
          "name": "Hearth of Moonlight and Shadow",
          "text": "A 30-foot camp during a rest that grants concealment, silence, and a bonus to Perception and Stealth for everyone inside."
        }
      ],
      "10": [
        {
          "name": "Hidden Paths",
          "text": "A bonus action teleports you 60 feet, or a creature you touch 30 feet, a Wisdom-modifier number of times per long rest."
        }
      ],
      "14": [
        {
          "name": "Walker in Dreams",
          "text": "After a short rest, cast dream, scrying or teleportation circle without a slot, the circle keyed to a place you have seen."
        }
      ]
    }
  },
  {
    "id": "shepherd",
    "classId": "druid",
    "name": "Circle of the Shepherd",
    "source": "odm",
    "aliases": [
      "shepherd",
      "circle-of-the-shepherd"
    ],
    "desc": "A speaker for the spirits of beasts and fey who summons help and keeps it alive.",
    "features": {
      "2": [
        {
          "name": "Speech of the Woods",
          "text": "You learn Sylvan and can speak with beasts."
        },
        {
          "name": "Spirit Totem",
          "text": "A bonus action calls a 30-foot spirit aura for a minute, once per short or long rest: Bear grants temporary hit points and Strength advantage, Hawk grants attack advantage as a reaction and Perception advantage, Unicorn grants attack advantage against creatures in it and boosts your healing."
        }
      ],
      "6": [
        {
          "name": "Mighty Summoner",
          "text": "Creatures you conjure gain 2 extra hit points per Hit Die and their attacks count as magical."
        }
      ],
      "10": [
        {
          "name": "Guardian Spirit",
          "text": "Summoned creatures inside your Spirit Totem aura heal half your druid level at the end of your turns."
        }
      ],
      "14": [
        {
          "name": "Faithful Summons",
          "text": "When you drop to 0 hit points, four dire wolves appear and defend you for an hour; recharges on a long rest."
        }
      ]
    }
  },
  {
    "id": "spores",
    "classId": "druid",
    "name": "Circle of Spores",
    "source": "odm",
    "aliases": [
      "spores",
      "circle-of-spores"
    ],
    "desc": "A druid of decay who sees rot as part of the cycle and wears a halo of necrotic spores.",
    "features": {
      "2": [
        {
          "name": "Halo of Spores",
          "text": "A reaction deals 1d4 necrotic damage to a creature within 10 feet on a failed Constitution save, scaling with druid level."
        },
        {
          "name": "Symbiotic Entity",
          "text": "Spend a Wild Shape use to gain four temporary hit points per druid level and add 1d6 necrotic to melee weapon hits for 10 minutes."
        }
      ],
      "6": [
        {
          "name": "Fungal Infestation",
          "text": "A reaction reanimates a beast or humanoid that dies within 10 feet as a zombie under your command for an hour, a Wisdom-modifier number of times per long rest."
        }
      ],
      "10": [
        {
          "name": "Spreading Spores",
          "text": "Hurl your spores into a 10-foot cube within 30 feet, damaging creatures that start their turn there instead of using Halo of Spores."
        }
      ],
      "14": [
        {
          "name": "Fungal Body",
          "text": "Immunity to blindness, deafness, fear and poison, and critical hits against you count as normal hits."
        }
      ]
    },
    "spells": {
      "2": [
        "chill_touch"
      ],
      "3": [
        "blindness_deafness",
        "gentle_repose"
      ],
      "5": [
        "animate_dead",
        "gaseous_form"
      ],
      "7": [
        "blight",
        "confusion"
      ],
      "9": [
        "cloudkill",
        "contagion"
      ]
    }
  },
  {
    "id": "stars",
    "classId": "druid",
    "name": "Circle of Stars",
    "source": "odm",
    "aliases": [
      "stars",
      "circle-of-stars",
      "circle of the stars"
    ],
    "desc": "A druid who reads the constellations and takes their shapes: archer, chalice and dragon.",
    "features": {
      "2": [
        {
          "name": "Star Map",
          "text": "A charted map serving as your spellcasting focus; you know guidance and can cast guiding bolt a proficiency-bonus number of times per long rest without a slot."
        },
        {
          "name": "Starry Form",
          "text": "Spend a Wild Shape use to glow with a constellation for 10 minutes: Archer gives a bonus-action ranged attack for 1d8 + Wisdom radiant damage, Chalice heals a second creature whenever you cast a healing spell, Dragon lets you treat a d20 of 9 or lower as a 10 on Intelligence and Wisdom checks and concentration saves."
        }
      ],
      "6": [
        {
          "name": "Cosmic Omen",
          "text": "After a long rest, read your map for Weal or Woe; a reaction then adds or subtracts a d6 on a roll near you, a proficiency-bonus number of times per long rest."
        }
      ],
      "10": [
        {
          "name": "Twinkling Constellations",
          "text": "Starry Form improves: Archer and Chalice roll 2d8, Dragon grants a 20-foot fly speed, and you may change constellation each turn."
        }
      ],
      "14": [
        {
          "name": "Full of Stars",
          "text": "While in Starry Form you are partly incorporeal and resist bludgeoning, piercing and slashing damage."
        }
      ]
    }
  },
  {
    "id": "wildfire",
    "classId": "druid",
    "name": "Circle of Wildfire",
    "source": "odm",
    "aliases": [
      "wildfire",
      "circle-of-wildfire"
    ],
    "desc": "A druid bonded to a wildfire spirit, holding to the truth that fire clears ground for new growth.",
    "features": {
      "2": [
        {
          "name": "Summon Wildfire Spirit",
          "text": "Spend a Wild Shape use to summon a wildfire spirit companion that acts on your turn, with a fiery teleport that damages creatures around its arrival."
        }
      ],
      "6": [
        {
          "name": "Enhanced Bond",
          "text": "While the spirit is out, your fire and healing spells gain 1d8, and you may cast them from the spirit's position."
        }
      ],
      "10": [
        {
          "name": "Cauterizing Flames",
          "text": "When a creature dies near you or the spirit, a flame springs up that either heals or burns the next creature to move through it for 2d10 + your Wisdom modifier."
        }
      ],
      "14": [
        {
          "name": "Blazing Revival",
          "text": "Once per long rest, dropping to 0 hit points destroys the spirit and returns you to half your hit point maximum instead."
        }
      ]
    },
    "spells": {
      "2": [
        "burning_hands",
        "cure_wounds"
      ],
      "3": [
        "blur",
        "scorching_ray"
      ],
      "5": [
        "revivify",
        "fireball"
      ],
      "7": [
        "aura_of_life",
        "fire_shield"
      ],
      "9": [
        "flame_strike",
        "mass_cure_wounds"
      ]
    }
  },
  {
    "id": "battle_master",
    "classId": "fighter",
    "name": "Battle Master",
    "source": "odm",
    "aliases": [
      "battlemaster",
      "battle-master"
    ],
    "desc": "A student of martial technique who spends superiority dice on precise, tide-turning maneuvers.",
    "features": {
      "3": [
        {
          "name": "Combat Superiority",
          "text": "Four superiority dice of d8, refilling on a short or long rest, spent on maneuvers with a save DC of 8 + proficiency + Strength or Dexterity. The dice grow to five at 7th level and six at 15th, and to d10 at 10th level and d12 at 18th."
        },
        {
          "name": "Maneuvers",
          "text": "Three maneuvers known, such as Trip Attack, Disarming Attack, Riposte, Precision Attack, Menacing Attack and Commander's Strike, rising to five known at 7th level, seven at 10th and nine at 15th."
        },
        {
          "name": "Student of War",
          "text": "Proficiency with one kind of artisan's tools."
        }
      ],
      "7": [
        {
          "name": "Know Your Enemy",
          "text": "A minute of observation reveals whether a creature beats you in two chosen traits such as Strength, Dexterity, Constitution, AC, current hit points, class levels or fighter levels."
        }
      ],
      "15": [
        {
          "name": "Relentless",
          "text": "When you roll initiative with no superiority dice left, you regain one."
        }
      ]
    }
  },
  {
    "id": "eldritch_knight",
    "classId": "fighter",
    "name": "Eldritch Knight",
    "source": "odm",
    "aliases": [
      "eldritch-knight"
    ],
    "desc": "A fighter who braids wizard magic into swordplay, casting and striking in the same breath.",
    "features": {
      "3": [
        {
          "name": "Spellcasting (Eldritch Knight)",
          "text": "Third-caster wizard spellcasting keyed to Intelligence, drawn mostly from abjuration and evocation."
        },
        {
          "name": "Weapon Bond",
          "text": "Bond up to two weapons in an hour-long ritual: you cannot be disarmed of them and can summon one to your hand as a bonus action."
        }
      ],
      "7": [
        {
          "name": "War Magic",
          "text": "After casting a cantrip with your action, a bonus action makes one weapon attack."
        }
      ],
      "10": [
        {
          "name": "Eldritch Strike",
          "text": "A weapon hit gives that creature disadvantage on its next save against a spell of yours before the end of your next turn."
        }
      ],
      "15": [
        {
          "name": "Arcane Charge",
          "text": "Action Surge also teleports you up to 30 feet."
        }
      ],
      "18": [
        {
          "name": "Improved War Magic",
          "text": "War Magic works after casting any spell, not only a cantrip."
        }
      ]
    }
  },
  {
    "id": "arcane_archer",
    "classId": "fighter",
    "name": "Arcane Archer",
    "source": "odm",
    "aliases": [
      "arcane-archer"
    ],
    "desc": "An elf-trained bowman who puts a spell on the arrow instead of in the air.",
    "features": {
      "3": [
        {
          "name": "Arcane Archer Lore",
          "text": "The prestidigitation or druidcraft cantrip, and proficiency in Arcana or Nature."
        },
        {
          "name": "Arcane Shot",
          "text": "Two Arcane Shot options known, used twice per short or long rest on an arrow hit: Banishing, Beguiling, Bursting, Enfeebling, Grasping, Piercing, Seeking or Shadow. More options are learned at 7th, 10th, 15th and 18th level."
        }
      ],
      "7": [
        {
          "name": "Magic Arrow",
          "text": "Arrows you fire from a shortbow or longbow count as magical."
        },
        {
          "name": "Curving Shot",
          "text": "A bonus action rerolls a missed magic-arrow attack against a different target within 60 feet."
        }
      ],
      "15": [
        {
          "name": "Ever-Ready Shot",
          "text": "When you roll initiative with no Arcane Shot uses left, you regain one."
        }
      ]
    }
  },
  {
    "id": "cavalier",
    "classId": "fighter",
    "name": "Cavalier",
    "source": "odm",
    "aliases": [
      "cavalier-fighter"
    ],
    "desc": "A mounted champion and battlefield anchor who makes enemies regret walking past.",
    "features": {
      "3": [
        {
          "name": "Bonus Proficiency (Cavalier)",
          "text": "Proficiency in Animal Handling, History, Insight, Performance or Persuasion, or one language of your choice."
        },
        {
          "name": "Born to the Saddle",
          "text": "Advantage on saves to stay mounted, mounting costs only 5 feet of movement, and you land on your feet from a fall of 10 feet or less."
        },
        {
          "name": "Unwavering Mark",
          "text": "A creature you hit in melee is marked until your next turn: it has disadvantage attacking anyone else, and on your next turn you can make a bonus attack against it that deals extra damage on a hit and gives it disadvantage on its next attack. Usable a Strength-modifier number of times per long rest."
        }
      ],
      "7": [
        {
          "name": "Warding Maneuver",
          "text": "When you or a creature you can see within 5 feet is hit, a reaction adds 1d8 to the target's AC against that attack while you wield a melee weapon or a shield, and the target resists its damage if it still hits; a Constitution-modifier number of times per long rest."
        }
      ],
      "10": [
        {
          "name": "Hold the Line",
          "text": "A reaction makes an opportunity attack against a creature that moves 5 feet or more while in your reach, stopping it dead."
        }
      ],
      "15": [
        {
          "name": "Ferocious Charger",
          "text": "Once per turn, a hit after moving 10 feet in a straight line knocks a Large or smaller creature prone on a failed Strength save."
        }
      ],
      "18": [
        {
          "name": "Vigilant Defender",
          "text": "You get a reaction opportunity attack on every other creature's turn, not just once per round."
        }
      ]
    }
  },
  {
    "id": "samurai",
    "classId": "fighter",
    "name": "Samurai",
    "source": "odm",
    "aliases": [
      "samurai-fighter"
    ],
    "desc": "A relentless warrior whose sheer conviction keeps them upright long past the point of sense.",
    "features": {
      "3": [
        {
          "name": "Bonus Proficiency (Samurai)",
          "text": "Proficiency in History, Insight, Performance or Persuasion, or one language of your choice."
        },
        {
          "name": "Fighting Spirit",
          "text": "A bonus action grants advantage on weapon attacks this turn and 5 temporary hit points, rising to 10 at 10th level and 15 at 15th; three uses per long rest."
        }
      ],
      "7": [
        {
          "name": "Elegant Courtier",
          "text": "Add your Wisdom modifier to Persuasion checks, and gain proficiency in Wisdom saving throws (Intelligence or Charisma if you already have it)."
        }
      ],
      "10": [
        {
          "name": "Tireless Spirit",
          "text": "When you roll initiative with no Fighting Spirit uses left, you regain one."
        }
      ],
      "15": [
        {
          "name": "Rapid Strike",
          "text": "Trade advantage on one attack for an extra attack against the same target."
        }
      ],
      "18": [
        {
          "name": "Strength before Death",
          "text": "Once per long rest, a reaction on taking damage lets you act immediately before the damage is applied."
        }
      ]
    }
  },
  {
    "id": "echo_knight",
    "classId": "fighter",
    "name": "Echo Knight",
    "source": "odm",
    "aliases": [
      "echo-knight"
    ],
    "desc": "A fighter haunted by a shard of another timeline, fighting beside a grey echo of themselves.",
    "features": {
      "3": [
        {
          "name": "Manifest Echo",
          "text": "A bonus action summons a magical echo of yourself within 15 feet with 1 hit point and your AC; you may attack from its space, swap places with it, and move it 30 feet as a bonus action."
        },
        {
          "name": "Unleash Incarnation",
          "text": "Make one extra melee attack from your echo's space when you take the Attack action, a Constitution-modifier number of times per long rest."
        }
      ],
      "7": [
        {
          "name": "Echo Avatar",
          "text": "Project your senses into the echo and send it up to 1,000 feet away for 10 minutes."
        }
      ],
      "10": [
        {
          "name": "Shadow Martyr",
          "text": "A reaction makes your echo take an attack aimed at another creature; once per short or long rest."
        }
      ],
      "15": [
        {
          "name": "Reclaim Potential",
          "text": "When your echo is destroyed by damage, gain temporary hit points of 2d6 + your Constitution modifier, a Constitution-modifier number of times per long rest."
        }
      ],
      "18": [
        {
          "name": "Legion of One",
          "text": "Regain a use of Unleash Incarnation on initiative, and manifest two echoes at once."
        }
      ]
    }
  },
  {
    "id": "psi_warrior",
    "classId": "fighter",
    "name": "Psi Warrior",
    "source": "odm",
    "aliases": [
      "psi-warrior",
      "psi knight"
    ],
    "desc": "A soldier whose mind is the weapon: telekinetic shoves, force shields and psionic strikes.",
    "features": {
      "3": [
        {
          "name": "Psionic Power (Psi Warrior)",
          "text": "A pool of Psionic Energy dice, twice your proficiency bonus per long rest, starting at d6 and growing with fighter level; one die returns on a short rest."
        },
        {
          "name": "Protective Field",
          "text": "A reaction spends a die to reduce damage to you or an ally within 30 feet by the die plus your Intelligence modifier."
        },
        {
          "name": "Psionic Strike",
          "text": "Once per turn, spend a die to add it plus your Intelligence modifier as force damage to a hit."
        },
        {
          "name": "Telekinetic Movement",
          "text": "Move a Large or smaller object or willing creature 30 feet with your mind, free once per short rest or by spending a die."
        }
      ],
      "7": [
        {
          "name": "Telekinetic Adept",
          "text": "Psi-Powered Leap lets you fly briefly as a bonus action, and Telekinetic Thrust can knock a Psionic Strike target prone or push it 10 feet."
        }
      ],
      "10": [
        {
          "name": "Guarded Mind",
          "text": "Resistance to psychic damage, and a reaction-free end to being charmed or frightened by spending a die."
        }
      ],
      "15": [
        {
          "name": "Bulwark of Force",
          "text": "A bonus action gives yourself and up to your Intelligence modifier in allies half cover for a minute; once per long rest or by spending a die."
        }
      ],
      "18": [
        {
          "name": "Telekinetic Master",
          "text": "Cast telekinesis for free once per long rest, and make one weapon attack as a bonus action while concentrating on it."
        }
      ]
    }
  },
  {
    "id": "rune_knight",
    "classId": "fighter",
    "name": "Rune Knight",
    "source": "odm",
    "aliases": [
      "rune-knight"
    ],
    "desc": "A warrior taught giant runecraft, carving power into gear and growing to giant size at need.",
    "features": {
      "3": [
        {
          "name": "Bonus Proficiencies (Rune Knight)",
          "text": "Smith's tools and the Giant language."
        },
        {
          "name": "Rune Carver",
          "text": "Inscribe runes on your gear, two at 3rd level and more at 7th, 10th and 15th: Cloud, Fire, Frost, Stone, Hill and Storm, each with a passive benefit and an invokable effect once per short or long rest."
        },
        {
          "name": "Giant's Might",
          "text": "A bonus action for a minute makes you Large, gives advantage on Strength checks and saves, and adds 1d6 to one damage roll per turn; a proficiency-bonus number of times per long rest."
        }
      ],
      "7": [
        {
          "name": "Runic Shield",
          "text": "A reaction forces an attacker to reroll a hit against an ally within 60 feet, a proficiency-bonus number of times per long rest."
        }
      ],
      "10": [
        {
          "name": "Great Stature",
          "text": "You grow 3d4 inches permanently and Giant's Might's bonus damage becomes 1d8."
        }
      ],
      "15": [
        {
          "name": "Master of Runes",
          "text": "Invoke each rune twice per short or long rest."
        }
      ],
      "18": [
        {
          "name": "Runic Juggernaut",
          "text": "Giant's Might deals 1d10 and can make you Huge with 5 extra feet of reach."
        }
      ]
    }
  },
  {
    "id": "banneret",
    "classId": "fighter",
    "name": "Banneret",
    "source": "odm",
    "aliases": [
      "purple dragon knight",
      "purple-dragon-knight",
      "banneret-fighter"
    ],
    "desc": "A knight-commander whose presence steadies a whole unit and spreads their own resilience around.",
    "features": {
      "3": [
        {
          "name": "Rallying Cry",
          "text": "Second Wind also heals up to three allies within 60 feet for your fighter level."
        }
      ],
      "7": [
        {
          "name": "Royal Envoy",
          "text": "Proficiency and expertise in Persuasion, plus one extra language."
        }
      ],
      "10": [
        {
          "name": "Inspiring Surge",
          "text": "Action Surge also lets an ally within 60 feet use a reaction to make one weapon attack, two allies from 18th level."
        }
      ],
      "15": [
        {
          "name": "Bulwark",
          "text": "Indomitable also lets one ally within 60 feet reroll a failed ability check."
        }
      ]
    }
  },
  {
    "id": "shadow",
    "classId": "monk",
    "name": "Way of Shadow",
    "source": "odm",
    "aliases": [
      "shadow",
      "way-of-shadow",
      "shadow monk"
    ],
    "desc": "A ninja-monk who bends darkness, steps between shadows and strikes from nowhere.",
    "features": {
      "3": [
        {
          "name": "Shadow Arts",
          "text": "Spend 2 ki to cast darkness, darkvision, pass without trace or silence, and you know minor illusion."
        }
      ],
      "6": [
        {
          "name": "Shadow Step",
          "text": "A bonus action teleports 60 feet between two patches of dim light or darkness, granting advantage on your next melee attack this turn."
        }
      ],
      "11": [
        {
          "name": "Cloak of Shadows",
          "text": "Become invisible in dim light or darkness until you attack, cast, or step into light."
        }
      ],
      "17": [
        {
          "name": "Opportunist",
          "text": "A reaction makes a melee attack against a creature within 5 feet that another creature just hit."
        }
      ]
    }
  },
  {
    "id": "four_elements",
    "classId": "monk",
    "name": "Way of the Four Elements",
    "source": "odm",
    "aliases": [
      "four elements",
      "way-of-the-four-elements",
      "elemental monk"
    ],
    "desc": "A monk who shapes ki into raw elemental magic: fists of fire, gusts of wind, walls of stone.",
    "features": {
      "3": [
        {
          "name": "Disciple of the Elements",
          "text": "Learn elemental disciplines cast by spending ki, starting with Elemental Attunement and one other, and gaining more at 6th, 11th and 17th level; spell save DC and attacks use your ki save DC."
        }
      ],
      "6": [
        {
          "name": "Elemental Discipline (6th)",
          "text": "One additional elemental discipline of a level your ki can pay for."
        }
      ],
      "11": [
        {
          "name": "Elemental Discipline (11th)",
          "text": "One additional elemental discipline."
        }
      ],
      "17": [
        {
          "name": "Elemental Discipline (17th)",
          "text": "One additional elemental discipline, up to the most powerful ones."
        }
      ]
    }
  },
  {
    "id": "drunken_master",
    "classId": "monk",
    "name": "Way of the Drunken Master",
    "source": "odm",
    "aliases": [
      "drunken master",
      "way-of-the-drunken-master"
    ],
    "desc": "A monk who fights like a stumbling drunk and is never where the blow lands.",
    "features": {
      "3": [
        {
          "name": "Bonus Proficiencies (Drunken Master)",
          "text": "Performance and brewer's supplies."
        },
        {
          "name": "Drunken Technique",
          "text": "Flurry of Blows also grants the benefit of Disengage and 10 feet of extra movement."
        }
      ],
      "6": [
        {
          "name": "Tipsy Sway",
          "text": "Leap to your feet from prone at the cost of 5 feet of movement, and spend 1 ki as a reaction to redirect a miss against you into another creature within 5 feet."
        }
      ],
      "11": [
        {
          "name": "Drunkard's Luck",
          "text": "Spend 2 ki to cancel disadvantage on an attack, check or save."
        }
      ],
      "17": [
        {
          "name": "Intoxicated Frenzy",
          "text": "Flurry of Blows grants up to three extra attacks, provided each one hits a different creature."
        }
      ]
    }
  },
  {
    "id": "kensei",
    "classId": "monk",
    "name": "Way of the Kensei",
    "source": "odm",
    "aliases": [
      "kensei",
      "way-of-the-kensei"
    ],
    "desc": "A weapon-saint who treats a chosen blade or bow as an extension of their unarmed art.",
    "features": {
      "3": [
        {
          "name": "Path of the Kensei",
          "text": "Two kensei weapons count as monk weapons, one ranged kensei weapon adds +2 AC as a bonus action, and an unarmed strike as a bonus action follows a kensei attack."
        },
        {
          "name": "Kensei's Shot",
          "text": "A bonus action adds 1d4 damage to ranged kensei attacks this turn."
        }
      ],
      "6": [
        {
          "name": "One with the Blade",
          "text": "Kensei weapons count as magical, and 1 ki adds your martial arts die to a hit's damage once per turn."
        }
      ],
      "11": [
        {
          "name": "Sharpen the Blade",
          "text": "Spend up to 3 ki as a bonus action for a matching bonus to attack and damage with a kensei weapon for a minute."
        }
      ],
      "17": [
        {
          "name": "Unerring Accuracy",
          "text": "Reroll a missed monk-weapon attack once per turn."
        }
      ]
    }
  },
  {
    "id": "sun_soul",
    "classId": "monk",
    "name": "Way of the Sun Soul",
    "source": "odm",
    "aliases": [
      "sun soul",
      "way-of-the-sun-soul"
    ],
    "desc": "A monk who burns ki as radiant light, striking at range and flaring like a small sun.",
    "features": {
      "3": [
        {
          "name": "Radiant Sun Bolt",
          "text": "A ranged spell attack for your martial arts die plus Dexterity in radiant damage at 30 feet, usable with the Attack action and extendable with ki as a bonus action."
        }
      ],
      "6": [
        {
          "name": "Searing Arc Strike",
          "text": "After the Attack action, spend 2 ki or more as a bonus action to cast burning hands at a matching level."
        }
      ],
      "11": [
        {
          "name": "Searing Sunburst",
          "text": "A 20-foot sphere within 150 feet deals 2d6 radiant on a failed Constitution save, up to 2d6 more per ki point spent."
        }
      ],
      "17": [
        {
          "name": "Sun Shield",
          "text": "Shed 30 feet of bright light at will and deal 5 + Wisdom radiant damage to anyone who hits you in melee."
        }
      ]
    }
  },
  {
    "id": "long_death",
    "classId": "monk",
    "name": "Way of the Long Death",
    "source": "odm",
    "aliases": [
      "long death",
      "way-of-the-long-death"
    ],
    "desc": "A monk who studies dying itself, drawing strength from every death nearby.",
    "features": {
      "3": [
        {
          "name": "Touch of Death",
          "text": "When a creature within 5 feet drops to 0 hit points, gain temporary hit points equal to your Wisdom modifier plus your monk level."
        }
      ],
      "6": [
        {
          "name": "Hour of Reaping",
          "text": "An action frightens every creature within 30 feet that fails a Wisdom save until the end of your next turn."
        }
      ],
      "11": [
        {
          "name": "Mastery of Death",
          "text": "Spend 1 ki to stay at 1 hit point instead of dropping to 0, as long as ki remains."
        }
      ],
      "17": [
        {
          "name": "Touch of the Long Death",
          "text": "Spend up to 10 ki to deal 2d10 necrotic per point to a creature within 5 feet, halved on a Constitution save."
        }
      ]
    }
  },
  {
    "id": "mercy",
    "classId": "monk",
    "name": "Way of Mercy",
    "source": "odm",
    "aliases": [
      "mercy",
      "way-of-mercy"
    ],
    "desc": "A masked healer-assassin whose hands can close a wound or stop a heart with the same touch.",
    "features": {
      "3": [
        {
          "name": "Implements of Mercy",
          "text": "Proficiency in Insight and Medicine and with a herbalism kit, plus a mask you are known by."
        },
        {
          "name": "Hand of Healing",
          "text": "Spend 1 ki as an action to heal a creature within 5 feet for your martial arts die plus your Wisdom modifier, or replace one Flurry of Blows attack with it."
        },
        {
          "name": "Hand of Harm",
          "text": "Once per turn, spend 1 ki on an unarmed hit for extra necrotic damage of your martial arts die plus your Wisdom modifier."
        }
      ],
      "6": [
        {
          "name": "Physician's Touch",
          "text": "Hand of Healing also ends one condition; Hand of Harm can poison the target until the end of your next turn."
        }
      ],
      "11": [
        {
          "name": "Flurry of Healing and Harm",
          "text": "Flurry of Blows can heal without ki cost, and one of its attacks can carry Hand of Harm free."
        }
      ],
      "17": [
        {
          "name": "Hand of Ultimate Mercy",
          "text": "Once per long rest, spend 5 ki to return a creature dead no more than 24 hours to life with 4d10 + Wisdom hit points."
        }
      ]
    }
  },
  {
    "id": "astral_self",
    "classId": "monk",
    "name": "Way of the Astral Self",
    "source": "odm",
    "aliases": [
      "astral self",
      "way-of-the-astral-self"
    ],
    "desc": "A monk who summons their own spirit outward as glowing arms, a watching visage and a full body.",
    "features": {
      "3": [
        {
          "name": "Arms of the Astral Self",
          "text": "Spend 1 ki as a bonus action to summon spectral arms for 10 minutes: they use Wisdom for unarmed attacks, deal your martial arts die in force damage, add 5 feet of reach, and can shove creatures within 10 feet."
        }
      ],
      "6": [
        {
          "name": "Visage of the Astral Self",
          "text": "Spend 1 ki for a spirit visage granting darkvision, advantage on Insight and Intimidation, and an Astral Sight that pierces darkness."
        }
      ],
      "11": [
        {
          "name": "Body of the Astral Self",
          "text": "With both arms and visage active, gain a Deflect Energy reaction and add 1d10 to a damage roll once per turn."
        }
      ],
      "17": [
        {
          "name": "Awakened Astral Self",
          "text": "Spend 5 ki for the complete astral body: +2 AC and an extra Arms attack when taking the Attack action."
        }
      ]
    }
  },
  {
    "id": "ascendant_dragon",
    "classId": "monk",
    "name": "Way of the Ascendant Dragon",
    "source": "odm",
    "aliases": [
      "ascendant dragon",
      "way-of-the-ascendant-dragon",
      "dragon monk"
    ],
    "desc": "A monk who studies dragons until their ki breathes, roars and flies like one.",
    "features": {
      "3": [
        {
          "name": "Draconic Disciple",
          "text": "You know Draconic, can shift your unarmed damage to acid, cold, fire, lightning or poison, and can add a d4 to a Charisma check once per short rest."
        },
        {
          "name": "Breath of the Dragon",
          "text": "Replace one Attack-action attack with a 20-foot cone or 30-foot line dealing two rolls of your martial arts die in damage, a proficiency-bonus number of times per long rest, or for 2 ki when none are left."
        }
      ],
      "6": [
        {
          "name": "Wings Unfurled",
          "text": "While airborne from a jump or effect, gain a flying speed equal to your walking speed, a proficiency-bonus number of times per long rest."
        }
      ],
      "11": [
        {
          "name": "Aspect of the Wyrm",
          "text": "A bonus action creates a 10-foot aura for a minute that either frightens enemies or grants allies resistance to your damage type; once per long rest or for 3 ki."
        }
      ],
      "17": [
        {
          "name": "Ascendant Aspect",
          "text": "Aspect of the Wyrm reaches 30 feet, grants blindsight, and once per turn lets you deal 3d10 damage to up to three creatures in it as a reaction."
        }
      ]
    }
  },
  {
    "id": "ancients",
    "classId": "paladin",
    "name": "Oath of the Ancients",
    "source": "odm",
    "aliases": [
      "ancients",
      "oath-of-the-ancients",
      "green knight"
    ],
    "desc": "A paladin sworn to light and life rather than law, shielding what is good from despair.",
    "features": {
      "3": [
        {
          "name": "Channel Divinity: Nature's Wrath",
          "text": "Spectral vines restrain a creature within 10 feet that fails a Strength or Dexterity save."
        },
        {
          "name": "Channel Divinity: Turn the Faithless",
          "text": "Fey and fiends within 30 feet that fail a Wisdom save are turned for a minute, and their disguises drop."
        }
      ],
      "7": [
        {
          "name": "Aura of Warding",
          "text": "You and allies within 10 feet have resistance to damage from spells, growing to 30 feet at 18th level."
        }
      ],
      "15": [
        {
          "name": "Undying Sentinel",
          "text": "Once per long rest, drop to 1 hit point instead of 0, and you no longer age or weaken with time."
        }
      ],
      "20": [
        {
          "name": "Elder Champion",
          "text": "For a minute: regain 10 hit points each turn, cast paladin spells as a bonus action, and enemies within 10 feet have disadvantage on saves against your spells and Channel Divinity."
        }
      ]
    },
    "spells": {
      "3": [
        "ensnaring_strike",
        "speak_with_animals"
      ],
      "5": [
        "moonbeam",
        "misty_step"
      ],
      "9": [
        "plant_growth",
        "protection_from_energy"
      ],
      "13": [
        "ice_storm",
        "stoneskin"
      ],
      "17": [
        "commune_with_nature",
        "tree_stride"
      ]
    }
  },
  {
    "id": "vengeance",
    "classId": "paladin",
    "name": "Oath of Vengeance",
    "source": "odm",
    "aliases": [
      "vengeance",
      "oath-of-vengeance",
      "dark knight"
    ],
    "desc": "A paladin who has chosen one wrong to punish and will spend everything to reach it.",
    "features": {
      "3": [
        {
          "name": "Channel Divinity: Abjure Enemy",
          "text": "One creature within 60 feet is frightened and its speed drops to 0 for a minute on a failed Wisdom save, half that on a success."
        },
        {
          "name": "Channel Divinity: Vow of Enmity",
          "text": "A bonus action grants advantage on attacks against one creature within 10 feet for a minute."
        }
      ],
      "7": [
        {
          "name": "Relentless Avenger",
          "text": "An opportunity-attack hit lets you move up to half your speed as part of the reaction, without provoking."
        }
      ],
      "15": [
        {
          "name": "Soul of Vengeance",
          "text": "A reaction makes a melee attack against a creature under your Vow of Enmity when it attacks."
        }
      ],
      "20": [
        {
          "name": "Avenging Angel",
          "text": "For an hour, gain a 60-foot flying speed and a 30-foot aura that frightens enemies who fail a Wisdom save, giving you advantage against them."
        }
      ]
    },
    "spells": {
      "3": [
        "bane",
        "hunters_mark"
      ],
      "5": [
        "hold_person",
        "misty_step"
      ],
      "9": [
        "haste",
        "protection_from_energy"
      ],
      "13": [
        "banishment",
        "dimension_door"
      ],
      "17": [
        "hold_monster",
        "scrying"
      ]
    }
  },
  {
    "id": "conquest",
    "classId": "paladin",
    "name": "Oath of Conquest",
    "source": "odm",
    "aliases": [
      "conquest",
      "oath-of-conquest"
    ],
    "desc": "A paladin who believes order is imposed, and rules the battlefield through fear.",
    "features": {
      "3": [
        {
          "name": "Channel Divinity: Conquering Presence",
          "text": "Every creature within 30 feet that fails a Wisdom save is frightened for a minute, saving again each turn."
        },
        {
          "name": "Channel Divinity: Guided Strike",
          "text": "Add +10 to one attack roll after seeing the result."
        }
      ],
      "7": [
        {
          "name": "Aura of Conquest",
          "text": "Frightened creatures within 10 feet have their speed reduced to 0 and take psychic damage equal to half your paladin level each turn; 30 feet at 18th level."
        }
      ],
      "15": [
        {
          "name": "Scornful Rebuke",
          "text": "A creature that hits you takes psychic damage equal to your Charisma modifier."
        }
      ],
      "20": [
        {
          "name": "Invincible Conqueror",
          "text": "For a minute: resistance to all damage, an extra attack with the Attack action, and melee critical hits on a 19 or 20."
        }
      ]
    },
    "spells": {
      "3": [
        "armor_of_agathys",
        "command"
      ],
      "5": [
        "hold_person",
        "spiritual_weapon"
      ],
      "9": [
        "bestow_curse",
        "fear"
      ],
      "13": [
        "dominate_beast",
        "stoneskin"
      ],
      "17": [
        "cloudkill",
        "dominate_person"
      ]
    }
  },
  {
    "id": "redemption",
    "classId": "paladin",
    "name": "Oath of Redemption",
    "source": "odm",
    "aliases": [
      "redemption",
      "oath-of-redemption"
    ],
    "desc": "A paladin who fights only when talking fails, and takes the blows meant for others.",
    "features": {
      "3": [
        {
          "name": "Channel Divinity: Emissary of Peace",
          "text": "A +5 bonus to Persuasion checks for 10 minutes."
        },
        {
          "name": "Channel Divinity: Rebuke the Violent",
          "text": "A reaction deals the same damage back to an attacker who wounded someone near you, halved on a Wisdom save."
        }
      ],
      "7": [
        {
          "name": "Aura of the Guardian",
          "text": "A reaction takes the damage aimed at an ally within 10 feet onto yourself, ignoring resistance; 30 feet at 18th level."
        }
      ],
      "15": [
        {
          "name": "Protective Spirit",
          "text": "Regain 1d6 + half your paladin level hit points at the end of your turn in combat when below half your maximum."
        }
      ],
      "20": [
        {
          "name": "Emissary of Redemption",
          "text": "Resistance to all damage from other creatures, and attackers take radiant damage equal to half of what they dealt you, until you attack or harm someone."
        }
      ]
    },
    "spells": {
      "3": [
        "sanctuary",
        "sleep"
      ],
      "5": [
        "calm_emotions",
        "hold_person"
      ],
      "9": [
        "counterspell",
        "hypnotic_pattern"
      ],
      "13": [
        "otilukes_resilient_sphere",
        "stoneskin"
      ],
      "17": [
        "hold_monster",
        "wall_of_force"
      ]
    }
  },
  {
    "id": "glory",
    "classId": "paladin",
    "name": "Oath of Glory",
    "source": "odm",
    "aliases": [
      "glory",
      "oath-of-glory"
    ],
    "desc": "A paladin who chases the heroic deed itself, and drags the whole party up to that standard.",
    "features": {
      "3": [
        {
          "name": "Channel Divinity: Peerless Athlete",
          "text": "For 10 minutes, advantage on Athletics and Acrobatics, extra carrying capacity, and 10 extra feet of jump distance."
        },
        {
          "name": "Channel Divinity: Inspiring Smite",
          "text": "After a Divine Smite, hand out temporary hit points of 2d8 + paladin level split among creatures within 30 feet."
        }
      ],
      "7": [
        {
          "name": "Aura of Alacrity",
          "text": "Your speed rises by 10 feet, and allies within 5 feet gain 10 feet of speed until their next turn; 10 feet of aura at 18th level."
        }
      ],
      "15": [
        {
          "name": "Glorious Defense",
          "text": "A reaction adds your Charisma modifier to the AC of yourself or an ally within 10 feet, and a resulting miss lets you attack the attacker; a Charisma-modifier number of times per long rest."
        }
      ],
      "20": [
        {
          "name": "Living Legend",
          "text": "For a minute: advantage on Charisma checks, a missed attack can be rerolled once per turn, and failed saves can be turned into successes once per turn."
        }
      ]
    },
    "spells": {
      "3": [
        "guiding_bolt",
        "heroism"
      ],
      "5": [
        "enhance_ability",
        "magic_weapon"
      ],
      "9": [
        "haste",
        "protection_from_energy"
      ],
      "13": [
        "compulsion",
        "freedom_of_movement"
      ],
      "17": [
        "commune",
        "flame_strike"
      ]
    }
  },
  {
    "id": "watchers",
    "classId": "paladin",
    "name": "Oath of the Watchers",
    "source": "odm",
    "aliases": [
      "watchers",
      "oath-of-the-watchers"
    ],
    "desc": "A paladin trained to detect and destroy extraplanar intruders before they take root.",
    "features": {
      "3": [
        {
          "name": "Channel Divinity: Watcher's Will",
          "text": "You and up to your Charisma modifier in allies gain advantage on Intelligence, Wisdom and Charisma saves for a minute."
        },
        {
          "name": "Channel Divinity: Abjure the Extraplanar",
          "text": "Aberrations, celestials, elementals, fey and fiends within 30 feet that fail a Wisdom save are turned for a minute."
        }
      ],
      "7": [
        {
          "name": "Aura of the Sentinel",
          "text": "You and allies within 10 feet add your proficiency bonus to initiative; 30 feet at 18th level."
        }
      ],
      "15": [
        {
          "name": "Vigilant Rebuke",
          "text": "A reaction deals 2d8 + Charisma force damage to a creature whose spell or effect you just saved against."
        }
      ],
      "20": [
        {
          "name": "Mortal Bulwark",
          "text": "For a minute: truesight to 120 feet, advantage on attacks against aberrations, celestials, elementals, fey and fiends, and a hit can banish one to its home plane on a failed Charisma save."
        }
      ]
    },
    "spells": {
      "3": [
        "alarm",
        "detect_magic"
      ],
      "5": [
        "moonbeam",
        "see_invisibility"
      ],
      "9": [
        "counterspell",
        "nondetection"
      ],
      "13": [
        "aura_of_purity",
        "banishment"
      ],
      "17": [
        "hold_monster",
        "scrying"
      ]
    }
  },
  {
    "id": "crown",
    "classId": "paladin",
    "name": "Oath of the Crown",
    "source": "odm",
    "aliases": [
      "crown",
      "oath-of-the-crown"
    ],
    "desc": "A paladin sworn to a realm and its law, holding the line so others can fall back.",
    "features": {
      "3": [
        {
          "name": "Channel Divinity: Champion Challenge",
          "text": "Creatures of your choice within 30 feet that fail a Wisdom save cannot move more than 30 feet away from you."
        },
        {
          "name": "Channel Divinity: Turn the Tide",
          "text": "Creatures of your choice within 30 feet below half hit points regain 1d6 + your Charisma modifier hit points."
        }
      ],
      "7": [
        {
          "name": "Divine Allegiance",
          "text": "A reaction takes the damage aimed at a creature within 5 feet onto yourself, ignoring resistance."
        }
      ],
      "15": [
        {
          "name": "Unyielding Spirit",
          "text": "Advantage on saving throws against being paralyzed or stunned."
        }
      ],
      "20": [
        {
          "name": "Exalted Champion",
          "text": "For an hour: resistance to nonmagical weapon damage, advantage on Wisdom saves for you and allies within 30 feet, and death saves at advantage for the same."
        }
      ]
    },
    "spells": {
      "3": [
        "command",
        "compelled_duel"
      ],
      "5": [
        "warding_bond",
        "zone_of_truth"
      ],
      "9": [
        "aura_of_vitality",
        "spirit_guardians"
      ],
      "13": [
        "banishment",
        "guardian_of_faith"
      ],
      "17": [
        "circle_of_power",
        "geas"
      ]
    }
  },
  {
    "id": "oathbreaker",
    "classId": "paladin",
    "name": "Oathbreaker",
    "source": "odm",
    "aliases": [
      "oath breaker",
      "oathbreaker-paladin"
    ],
    "desc": "A paladin who broke their oath for darker power and now commands the undead. Usually a villain.",
    "features": {
      "3": [
        {
          "name": "Channel Divinity: Control Undead",
          "text": "One undead of CR at or below your level within 30 feet obeys you for 24 hours on a failed Charisma save."
        },
        {
          "name": "Channel Divinity: Dreadful Aspect",
          "text": "Creatures of your choice within 30 feet that fail a Wisdom save are frightened for a minute."
        }
      ],
      "7": [
        {
          "name": "Aura of Hate",
          "text": "You, fiends and undead within 10 feet add your Charisma modifier to melee weapon damage; 30 feet at 18th level."
        }
      ],
      "15": [
        {
          "name": "Supernatural Resistance",
          "text": "Resistance to nonmagical bludgeoning, piercing and slashing damage."
        }
      ],
      "20": [
        {
          "name": "Dread Lord",
          "text": "For a minute: a 30-foot aura of magical darkness that deals 4d10 psychic damage to enemies who start their turn in it, gives attackers disadvantage against you, and lets you make a spectral 4d10 psychic attack as a bonus action."
        }
      ]
    },
    "spells": {
      "3": [
        "hellish_rebuke",
        "inflict_wounds"
      ],
      "5": [
        "crown_of_madness",
        "darkness"
      ],
      "9": [
        "animate_dead",
        "bestow_curse"
      ],
      "13": [
        "blight",
        "confusion"
      ],
      "17": [
        "contagion",
        "dominate_person"
      ]
    }
  },
  {
    "id": "beast_master",
    "classId": "ranger",
    "name": "Beast Master",
    "source": "odm",
    "aliases": [
      "beast master",
      "beastmaster",
      "beast-master"
    ],
    "desc": "A ranger who fights alongside a bonded animal companion that acts on their command.",
    "features": {
      "3": [
        {
          "name": "Ranger's Companion",
          "text": "A beast of CR 1/4 or lower obeys your commands, adds your proficiency bonus to its rolls and AC, uses your hit points formula and takes the Dodge action unless you command otherwise."
        }
      ],
      "7": [
        {
          "name": "Exceptional Training",
          "text": "A bonus action lets the companion Dash, Disengage, Dodge or Help, and its attacks count as magical."
        }
      ],
      "11": [
        {
          "name": "Bestial Fury",
          "text": "Your companion makes two attacks when you command it to attack."
        }
      ],
      "15": [
        {
          "name": "Share Spells",
          "text": "A spell you cast on yourself also affects your companion within 30 feet."
        }
      ]
    }
  },
  {
    "id": "gloom_stalker",
    "classId": "ranger",
    "name": "Gloom Stalker",
    "source": "odm",
    "aliases": [
      "gloom stalker",
      "gloom-stalker"
    ],
    "desc": "A ranger of the lightless places who is deadliest in the first seconds of a fight.",
    "features": {
      "3": [
        {
          "name": "Dread Ambusher",
          "text": "+ your Wisdom modifier to initiative, and on your first turn 10 extra feet of speed plus one extra attack dealing an extra 1d8."
        },
        {
          "name": "Umbral Sight",
          "text": "Darkvision 60 feet, or 30 more if you had it, and you are invisible to creatures relying on darkvision to see you in darkness."
        }
      ],
      "7": [
        {
          "name": "Iron Mind",
          "text": "Proficiency in Wisdom saves, or Intelligence or Charisma if you already have it."
        }
      ],
      "11": [
        {
          "name": "Stalker's Flurry",
          "text": "Once per turn, a missed attack lets you make another one."
        }
      ],
      "15": [
        {
          "name": "Shadowy Dodge",
          "text": "A reaction imposes disadvantage on an attack against you that would otherwise hit."
        }
      ]
    },
    "spells": {
      "3": [
        "disguise_self"
      ],
      "5": [
        "rope_trick"
      ],
      "9": [
        "fear"
      ],
      "13": [
        "greater_invisibility"
      ],
      "17": [
        "seeming"
      ]
    }
  },
  {
    "id": "horizon_walker",
    "classId": "ranger",
    "name": "Horizon Walker",
    "source": "odm",
    "aliases": [
      "horizon walker",
      "horizon-walker"
    ],
    "desc": "A ranger who patrols the seams between planes and steps through them mid-fight.",
    "features": {
      "3": [
        {
          "name": "Detect Portal",
          "text": "Sense a planar portal within a mile once per short or long rest."
        },
        {
          "name": "Planar Warrior",
          "text": "A bonus action marks a target so your next hit this turn deals its weapon damage plus 1d8 force as force damage; 2d8 from 11th level."
        }
      ],
      "7": [
        {
          "name": "Ethereal Step",
          "text": "Cast etherealness as a bonus action for one turn, once per short or long rest."
        }
      ],
      "11": [
        {
          "name": "Distant Strike",
          "text": "Teleport 10 feet before each attack, and attack a third creature if you struck two others this turn."
        }
      ],
      "15": [
        {
          "name": "Spectral Defense",
          "text": "A reaction halves the damage of an attack that hits you."
        }
      ]
    },
    "spells": {
      "3": [
        "protection_from_evil_and_good"
      ],
      "5": [
        "misty_step"
      ],
      "9": [
        "haste"
      ],
      "13": [
        "banishment"
      ],
      "17": [
        "teleportation_circle"
      ]
    }
  },
  {
    "id": "monster_slayer",
    "classId": "ranger",
    "name": "Monster Slayer",
    "source": "odm",
    "aliases": [
      "monster slayer",
      "monster-slayer"
    ],
    "desc": "A ranger trained on the things that hunt people: their tricks, their saves, their weaknesses.",
    "features": {
      "3": [
        {
          "name": "Hunter's Sense",
          "text": "An action reveals a creature's damage immunities, resistances and vulnerabilities, a Wisdom-modifier number of times per long rest."
        },
        {
          "name": "Slayer's Prey",
          "text": "A bonus action marks a creature so your first hit against it each turn deals an extra 1d6."
        }
      ],
      "7": [
        {
          "name": "Supernatural Defense",
          "text": "Add 1d6 to saves and escape checks against effects from your Slayer's Prey target."
        }
      ],
      "11": [
        {
          "name": "Magic-User's Nemesis",
          "text": "A reaction forces a caster or teleporter within 60 feet to make a Wisdom save or lose the spell; once per short or long rest."
        }
      ],
      "15": [
        {
          "name": "Slayer's Counter",
          "text": "A reaction attacks your prey when it forces a save on you, and a hit means the save automatically succeeds."
        }
      ]
    },
    "spells": {
      "3": [
        "protection_from_evil_and_good"
      ],
      "5": [
        "zone_of_truth"
      ],
      "9": [
        "magic_circle"
      ],
      "13": [
        "dimension_door"
      ],
      "17": [
        "hold_monster"
      ]
    }
  },
  {
    "id": "fey_wanderer",
    "classId": "ranger",
    "name": "Fey Wanderer",
    "source": "odm",
    "aliases": [
      "fey wanderer",
      "fey-wanderer"
    ],
    "desc": "A ranger carrying a piece of the Feywild: a strange mien, cutting words and psychic strikes.",
    "features": {
      "3": [
        {
          "name": "Dreadful Strikes",
          "text": "Once per turn, a weapon hit deals an extra 1d4 psychic damage, rising to 1d6 at 11th level."
        },
        {
          "name": "Otherworldly Glamour",
          "text": "Add your Wisdom modifier to Charisma checks, and gain proficiency in Deception, Performance or Persuasion."
        },
        {
          "name": "Fey Wanderer Magic",
          "text": "Charm person and other fey spells are always prepared and do not count against your spells known."
        }
      ],
      "7": [
        {
          "name": "Beguiling Twist",
          "text": "Advantage on saves against being charmed or frightened, and a reaction redirects a nearby charm or fear onto another creature."
        }
      ],
      "11": [
        {
          "name": "Fey Reinforcements",
          "text": "Summon fey is always prepared and can be cast once per long rest without a slot, with the summon able to turn invisible."
        }
      ],
      "15": [
        {
          "name": "Misty Wanderer",
          "text": "Cast misty step without a slot a Wisdom-modifier number of times per long rest, bringing a willing creature within 5 feet along."
        }
      ]
    },
    "spells": {
      "3": [
        "charm_person"
      ],
      "5": [
        "misty_step"
      ],
      "9": [
        "dispel_magic"
      ],
      "13": [
        "dimension_door"
      ],
      "17": [
        "mislead"
      ]
    }
  },
  {
    "id": "swarmkeeper",
    "classId": "ranger",
    "name": "Swarmkeeper",
    "source": "odm",
    "aliases": [
      "swarmkeeper",
      "swarm keeper"
    ],
    "desc": "A ranger accompanied by a bound swarm of tiny nature spirits that bite, shove and carry.",
    "features": {
      "3": [
        {
          "name": "Gathered Swarm",
          "text": "Once per turn, a hit lets your swarm deal 1d6 piercing damage, move the target 15 feet, or move you 5 feet without provoking; 1d8 from 11th level."
        },
        {
          "name": "Swarmkeeper Magic",
          "text": "Mage hand and a short list of swarm spells are always prepared and do not count against your spells known."
        }
      ],
      "7": [
        {
          "name": "Writhing Tide",
          "text": "A bonus action grants a 10-foot flying speed for a minute, a proficiency-bonus number of times per long rest."
        }
      ],
      "11": [
        {
          "name": "Mighty Swarm",
          "text": "Gathered Swarm knocks moved targets prone, gives you half cover when it moves you, and adds 1d6 to its damage."
        }
      ],
      "15": [
        {
          "name": "Swarming Dispersal",
          "text": "A reaction gives resistance to damage taken and teleports you 30 feet, a proficiency-bonus number of times per long rest."
        }
      ]
    },
    "spells": {
      "3": [
        "faerie_fire"
      ],
      "5": [
        "web"
      ],
      "9": [
        "gaseous_form"
      ],
      "13": [
        "arcane_eye"
      ],
      "17": [
        "insect_plague"
      ]
    }
  },
  {
    "id": "drakewarden",
    "classId": "ranger",
    "name": "Drakewarden",
    "source": "odm",
    "aliases": [
      "drakewarden",
      "drake warden"
    ],
    "desc": "A ranger bonded to a young draconic spirit that grows from a helper into a mount.",
    "features": {
      "3": [
        {
          "name": "Draconic Gift",
          "text": "You know thaumaturgy and can speak Draconic."
        },
        {
          "name": "Drake Companion",
          "text": "Summon a Small drake once per long rest or with a spell slot; it acts on your turn, adds your proficiency bonus to its rolls, and has an elemental breath."
        }
      ],
      "7": [
        {
          "name": "Bond of Fang and Scale",
          "text": "While the drake is out, you gain resistance to its damage type, the drake gains a fly speed, and your attacks count as magical with extra elemental damage."
        }
      ],
      "11": [
        {
          "name": "Drake's Breath",
          "text": "Once per long rest, the drake exhales a 30-foot cone dealing 8d6 of its element, halved on a Dexterity save."
        }
      ],
      "15": [
        {
          "name": "Perfected Bond",
          "text": "The drake becomes Large and rideable, gains extra hit points, and adds your proficiency bonus in damage to its attacks."
        }
      ]
    }
  },
  {
    "id": "assassin",
    "classId": "rogue",
    "name": "Assassin",
    "source": "odm",
    "aliases": [
      "assassin-rogue"
    ],
    "desc": "A killer who opens fights already having won them, and wears other people's faces to get close.",
    "features": {
      "3": [
        {
          "name": "Bonus Proficiencies (Assassin)",
          "text": "Proficiency with the disguise kit and the poisoner's kit."
        },
        {
          "name": "Assassinate",
          "text": "Advantage on attacks against any creature that has not taken a turn yet, and any hit against a surprised creature is a critical hit."
        }
      ],
      "9": [
        {
          "name": "Infiltration Expertise",
          "text": "Spend 25 gp and seven days to build a false identity you can adopt convincingly."
        }
      ],
      "13": [
        {
          "name": "Impostor",
          "text": "After studying someone for three hours, mimic their speech, writing and behaviour well enough to fool most observers."
        }
      ],
      "17": [
        {
          "name": "Death Strike",
          "text": "When you hit a surprised creature, it makes a Constitution save against 8 + Dexterity + proficiency or takes double damage."
        }
      ]
    }
  },
  {
    "id": "arcane_trickster",
    "classId": "rogue",
    "name": "Arcane Trickster",
    "source": "odm",
    "aliases": [
      "arcane-trickster"
    ],
    "desc": "A thief who studied just enough wizardry to make locks, pockets and minds easier work.",
    "features": {
      "3": [
        {
          "name": "Spellcasting (Arcane Trickster)",
          "text": "Third-caster wizard spellcasting keyed to Intelligence, drawn mostly from enchantment and illusion."
        },
        {
          "name": "Mage Hand Legerdemain",
          "text": "Your mage hand is invisible, and can pick locks, disarm traps, stow items and pick pockets at your Sleight of Hand bonus."
        }
      ],
      "9": [
        {
          "name": "Magical Ambush",
          "text": "A creature you are hidden from has disadvantage on saves against your spell that turn."
        }
      ],
      "13": [
        {
          "name": "Versatile Trickster",
          "text": "A bonus action uses mage hand to distract a creature, giving you advantage on attacks against it that turn."
        }
      ],
      "17": [
        {
          "name": "Spell Thief",
          "text": "A reaction steals a spell cast at you on a failed save by the caster, denying them the spell for 8 hours and letting you cast it once; recharges on a long rest."
        }
      ]
    }
  },
  {
    "id": "mastermind",
    "classId": "rogue",
    "name": "Mastermind",
    "source": "odm",
    "aliases": [
      "mastermind-rogue"
    ],
    "desc": "A schemer who reads people, plants words and directs the fight from behind an ally's shoulder.",
    "features": {
      "3": [
        {
          "name": "Master of Intrigue",
          "text": "Proficiency with the disguise kit, forgery kit and one gaming set, two extra languages, and the ability to mimic a heard speech pattern and accent."
        },
        {
          "name": "Master of Tactics",
          "text": "Use the Help action as a bonus action at up to 30 feet."
        }
      ],
      "9": [
        {
          "name": "Insightful Manipulator",
          "text": "A minute of observation reveals whether a creature is your better or worse in Intelligence, Wisdom, Charisma and class levels."
        }
      ],
      "13": [
        {
          "name": "Misdirection",
          "text": "A reaction redirects an attack aimed at you onto a creature within 5 feet that is giving you cover."
        }
      ],
      "17": [
        {
          "name": "Soul of Deceit",
          "text": "Your thoughts cannot be read, magic always reads you as truthful, and you choose what a mind-reader finds."
        }
      ]
    }
  },
  {
    "id": "swashbuckler",
    "classId": "rogue",
    "name": "Swashbuckler",
    "source": "odm",
    "aliases": [
      "swashbuckler-rogue"
    ],
    "desc": "A duellist who fights in the open, one on one, and talks the whole time.",
    "features": {
      "3": [
        {
          "name": "Fancy Footwork",
          "text": "A creature you attack in melee cannot make opportunity attacks against you for the rest of your turn."
        },
        {
          "name": "Rakish Audacity",
          "text": "Add your Charisma modifier to initiative, and sneak attack works whenever you are within 5 feet of your target alone, with no need for advantage."
        }
      ],
      "9": [
        {
          "name": "Panache",
          "text": "A Persuasion check against a creature's Insight either charms it into following you peacefully or fixes its attention on you in a fight for a minute."
        }
      ],
      "13": [
        {
          "name": "Elegant Maneuver",
          "text": "A bonus action grants advantage on your next Acrobatics or Athletics check."
        }
      ],
      "17": [
        {
          "name": "Master Duelist",
          "text": "Once per short or long rest, reroll a missed attack with advantage."
        }
      ]
    }
  },
  {
    "id": "inquisitive",
    "classId": "rogue",
    "name": "Inquisitive",
    "source": "odm",
    "aliases": [
      "inquisitive-rogue",
      "detective"
    ],
    "desc": "A detective-rogue who finds the tell, the lie and the weak point, then puts a blade in it.",
    "features": {
      "3": [
        {
          "name": "Ear for Deceit",
          "text": "Treat any Insight roll of 7 or lower as an 8."
        },
        {
          "name": "Eye for Detail",
          "text": "A bonus action makes a Perception check for hidden things or an Investigation check for clues."
        },
        {
          "name": "Insightful Fighting",
          "text": "A bonus-action Insight check against a creature's Deception lets you sneak attack it for a minute without needing advantage or an ally."
        }
      ],
      "9": [
        {
          "name": "Steady Eye",
          "text": "Advantage on Perception and Investigation checks after moving no more than half your speed on your turn."
        }
      ],
      "13": [
        {
          "name": "Unerring Eye",
          "text": "Sense illusions, shapechangers and other deceptions within 30 feet, a Wisdom-modifier number of times per long rest."
        }
      ],
      "17": [
        {
          "name": "Eye for Weakness",
          "text": "Sneak attack against your Insightful Fighting target deals an extra 3d6."
        }
      ]
    }
  },
  {
    "id": "scout",
    "classId": "rogue",
    "name": "Scout",
    "source": "odm",
    "aliases": [
      "scout-rogue"
    ],
    "desc": "A skirmisher and pathfinder who slips out of reach the moment anyone closes.",
    "features": {
      "3": [
        {
          "name": "Skirmisher",
          "text": "A reaction moves you half your speed when an enemy ends its turn within 5 feet, without provoking."
        },
        {
          "name": "Survivalist",
          "text": "Proficiency and expertise in Nature and Survival."
        }
      ],
      "9": [
        {
          "name": "Superior Mobility",
          "text": "Your walking speed rises by 10 feet, along with any climb or swim speed you have."
        }
      ],
      "13": [
        {
          "name": "Ambush Master",
          "text": "Advantage on initiative, and the first creature you hit on your first turn gives your allies advantage against it until your next turn."
        }
      ],
      "17": [
        {
          "name": "Sudden Strike",
          "text": "A bonus action makes an extra attack, and you can sneak attack twice per turn as long as it is against different targets."
        }
      ]
    }
  },
  {
    "id": "phantom",
    "classId": "rogue",
    "name": "Phantom",
    "source": "odm",
    "aliases": [
      "phantom-rogue"
    ],
    "desc": "A rogue standing half in the land of the dead, collecting skills and souls as they go.",
    "features": {
      "3": [
        {
          "name": "Whispers of the Dead",
          "text": "After each rest, gain proficiency in one skill or tool of your choice."
        },
        {
          "name": "Wails from the Grave",
          "text": "After a sneak attack drops or wounds a creature, a second creature within 30 feet takes half your sneak attack dice in necrotic damage; a proficiency-bonus number of times per long rest."
        }
      ],
      "9": [
        {
          "name": "Tokens of the Departed",
          "text": "A soul trinket forms when a creature dies near you: it grants advantage on death and Constitution saves, resistance to poison, and can be spent to power Wails from the Grave or question the dead."
        }
      ],
      "13": [
        {
          "name": "Ghost Walk",
          "text": "A bonus action makes you spectral for 10 minutes with a 10-foot fly speed and the ability to move through creatures and objects; free once per long rest, otherwise costs a soul trinket."
        }
      ],
      "17": [
        {
          "name": "Death's Friend",
          "text": "Wails from the Grave triggers alongside every sneak attack at full strength, and a soul trinket forms at the end of each long rest."
        }
      ]
    }
  },
  {
    "id": "soulknife",
    "classId": "rogue",
    "name": "Soulknife",
    "source": "odm",
    "aliases": [
      "soulknife-rogue",
      "soul knife"
    ],
    "desc": "A rogue whose weapons are made of thought, thrown and re-formed at will.",
    "features": {
      "3": [
        {
          "name": "Psionic Power (Soulknife)",
          "text": "A pool of Psionic Energy dice, twice your proficiency bonus per long rest, starting at d6 and growing with rogue level; one returns on a short rest."
        },
        {
          "name": "Psi-Bolstered Knack",
          "text": "Spend a die to turn a failed check with a proficient skill or tool into a success if the die closes the gap."
        },
        {
          "name": "Psychic Whispers",
          "text": "Establish telepathic communication with creatures you can see for hours, free once per long rest and otherwise for a die."
        },
        {
          "name": "Psychic Blades",
          "text": "Manifest a thrown or melee psychic blade as part of an attack, dealing 1d6 psychic plus ability modifier, with a bonus-action second blade at 1d4; the dice grow with rogue level."
        }
      ],
      "9": [
        {
          "name": "Soul Blades",
          "text": "Homing Strikes adds a die to a missed Psychic Blades attack, and Psychic Teleportation throws a blade to teleport yourself up to 10 times your die roll in feet."
        }
      ],
      "13": [
        {
          "name": "Psychic Veil",
          "text": "Turn invisible for an hour as an action, free once per long rest and otherwise for a die; it ends if you deal damage or force a save."
        }
      ],
      "17": [
        {
          "name": "Rend Mind",
          "text": "A sneak attack with Psychic Blades can stun a creature for a minute on a failed Wisdom save; free once per long rest and otherwise for three dice."
        }
      ]
    }
  },
  {
    "id": "wild_magic",
    "classId": "sorcerer",
    "name": "Wild Magic",
    "source": "odm",
    "aliases": [
      "wild magic sorcerer",
      "wild-magic"
    ],
    "desc": "A sorcerer whose power came from somewhere chaotic and has never fully settled down.",
    "features": {
      "1": [
        {
          "name": "Wild Magic Surge",
          "text": "After casting a sorcerer spell of 1st level or higher, the DM may have you roll a d20; on a 1 you roll on the wild magic table."
        },
        {
          "name": "Tides of Chaos",
          "text": "Gain advantage on one attack, check or save; the DM can then trigger a Wild Magic Surge to restore the use."
        }
      ],
      "6": [
        {
          "name": "Bend Luck",
          "text": "A reaction spends 2 sorcery points to add or subtract 1d4 on another creature's attack, check or save."
        }
      ],
      "14": [
        {
          "name": "Controlled Chaos",
          "text": "Roll twice on the wild magic table and pick either result."
        }
      ],
      "18": [
        {
          "name": "Spell Bombardment",
          "text": "Once per turn, the highest damage die you roll for a spell explodes: roll it again and add it."
        }
      ]
    }
  },
  {
    "id": "divine_soul",
    "classId": "sorcerer",
    "name": "Divine Soul",
    "source": "odm",
    "aliases": [
      "divine soul",
      "divine-soul",
      "favored soul"
    ],
    "desc": "A sorcerer whose bloodline runs back to something divine, mixing cleric magic into raw sorcery.",
    "features": {
      "1": [
        {
          "name": "Divine Magic",
          "text": "Add the cleric spell list to your sorcerer spell choices, plus one affinity spell matching your divine bent."
        },
        {
          "name": "Favored by the Gods",
          "text": "Once per short or long rest, add 2d4 to a failed save or missed attack."
        }
      ],
      "6": [
        {
          "name": "Empowered Healing",
          "text": "Spend 1 sorcery point to reroll healing dice for yourself or an ally, once per turn."
        }
      ],
      "14": [
        {
          "name": "Otherworldly Wings",
          "text": "A bonus action grants a 30-foot flying speed with spectral wings."
        }
      ],
      "18": [
        {
          "name": "Unearthly Recovery",
          "text": "Once per long rest, a bonus action when you have fewer than half your hit points left restores hit points equal to half your maximum."
        }
      ]
    }
  },
  {
    "id": "shadow_magic",
    "classId": "sorcerer",
    "name": "Shadow Magic",
    "source": "odm",
    "aliases": [
      "shadow magic",
      "shadow-magic",
      "shadow sorcerer"
    ],
    "desc": "A sorcerer touched by the Shadowfell, hard to kill and accompanied by a hound of ill omen.",
    "features": {
      "1": [
        {
          "name": "Eyes of the Dark",
          "text": "Darkvision to 120 feet, and darkness can be cast for 2 sorcery points and seen through."
        },
        {
          "name": "Strength of the Grave",
          "text": "A Charisma save against 5 + the damage leaves you at 1 hit point instead of 0; once per long rest."
        }
      ],
      "6": [
        {
          "name": "Hound of Ill Omen",
          "text": "Spend 3 sorcery points to summon a shadow dire wolf that chases one creature, gives your spells advantage against it, and blocks its escape."
        }
      ],
      "14": [
        {
          "name": "Shadow Walk",
          "text": "A bonus action teleports 120 feet between dim or dark spaces."
        }
      ],
      "18": [
        {
          "name": "Umbral Form",
          "text": "Spend 6 sorcery points to become shadow for a minute: resistance to all but force and radiant damage, and the ability to move through creatures and objects."
        }
      ]
    }
  },
  {
    "id": "storm_sorcery",
    "classId": "sorcerer",
    "name": "Storm Sorcery",
    "source": "odm",
    "aliases": [
      "storm sorcery",
      "storm-sorcery",
      "stormborn"
    ],
    "desc": "A sorcerer of wind and thunder who drifts through fights on their own weather.",
    "features": {
      "1": [
        {
          "name": "Wind Speaker",
          "text": "You speak, read and write Primordial and its dialects."
        },
        {
          "name": "Tempestuous Magic",
          "text": "Before or after casting a spell of 1st level or higher, a bonus action lets you fly 10 feet without provoking."
        }
      ],
      "6": [
        {
          "name": "Heart of the Storm",
          "text": "Resistance to lightning and thunder damage, and casting a spell of those types deals half your sorcerer level in damage to creatures within 10 feet."
        }
      ],
      "14": [
        {
          "name": "Storm Guide",
          "text": "Stop rain around you or steer the wind's direction as a bonus action."
        },
        {
          "name": "Storm's Fury",
          "text": "A reaction deals your sorcerer level in lightning damage to a melee attacker and pushes it 20 feet on a failed Strength save."
        }
      ],
      "18": [
        {
          "name": "Wind Soul",
          "text": "Immunity to lightning and thunder damage, a 60-foot flying speed, and the ability to grant allies 30 feet of flight for an hour, once per short or long rest."
        }
      ]
    }
  },
  {
    "id": "aberrant_mind",
    "classId": "sorcerer",
    "name": "Aberrant Mind",
    "source": "odm",
    "aliases": [
      "aberrant mind",
      "aberrant-mind",
      "psionic soul"
    ],
    "desc": "A sorcerer whose gift came from something far outside, and speaks in telepathy and warped magic.",
    "features": {
      "1": [
        {
          "name": "Psionic Spells",
          "text": "A set of psionic spells always known that do not count against your spells known, swappable for divination and enchantment spells as you level."
        },
        {
          "name": "Telepathic Speech",
          "text": "A bonus action opens a telepathic link with one creature within 30 feet for minutes equal to your sorcerer level."
        }
      ],
      "6": [
        {
          "name": "Psionic Sorcery",
          "text": "Cast your psionic spells by spending sorcery points instead of a slot, with no verbal, somatic or costly components."
        },
        {
          "name": "Psychic Defenses",
          "text": "Resistance to psychic damage and advantage on saves against being charmed or frightened."
        }
      ],
      "14": [
        {
          "name": "Revelation in Flesh",
          "text": "Spend 1 or more sorcery points for a minute of aberrant change: see invisible things, swim and breathe water, fly, or squeeze through tiny gaps."
        }
      ],
      "18": [
        {
          "name": "Warping Implosion",
          "text": "Once per long rest, teleport 120 feet and pull creatures toward your old space for 3d10 force damage."
        }
      ]
    },
    "spells": {
      "1": [
        "arms_of_hadar",
        "dissonant_whispers",
        "mind_sliver"
      ],
      "3": [
        "calm_emotions",
        "detect_thoughts"
      ],
      "5": [
        "hunger_of_hadar",
        "sending"
      ],
      "7": [
        "evards_black_tentacles",
        "summon_aberration"
      ],
      "9": [
        "rarys_telepathic_bond",
        "telekinesis"
      ]
    }
  },
  {
    "id": "clockwork_soul",
    "classId": "sorcerer",
    "name": "Clockwork Soul",
    "source": "odm",
    "aliases": [
      "clockwork soul",
      "clockwork-soul"
    ],
    "desc": "A sorcerer aligned to the machinery of absolute order, smoothing chaos out of the world.",
    "features": {
      "1": [
        {
          "name": "Clockwork Magic",
          "text": "A set of order-themed spells always known that do not count against your spells known, swappable for abjuration and transmutation spells as you level."
        },
        {
          "name": "Restore Balance",
          "text": "A reaction cancels advantage or disadvantage on a roll within 60 feet, a proficiency-bonus number of times per long rest."
        }
      ],
      "6": [
        {
          "name": "Bastion of Law",
          "text": "Spend 1 to 5 sorcery points to give a creature that many d8s to spend reducing damage, until your next long rest."
        }
      ],
      "14": [
        {
          "name": "Trance of Order",
          "text": "For a minute, attacks against you cannot have advantage and you treat any d20 of 9 or lower as a 10 on attacks, checks and saves; once per long rest or for 5 sorcery points."
        }
      ],
      "18": [
        {
          "name": "Clockwork Cavalcade",
          "text": "A 30-foot cube heals 100 hit points among creatures in it, ends spells of 6th level or lower, and repairs damaged objects; once per long rest or for 7 sorcery points."
        }
      ]
    },
    "spells": {
      "1": [
        "alarm",
        "protection_from_evil_and_good"
      ],
      "3": [
        "aid",
        "lesser_restoration"
      ],
      "5": [
        "dispel_magic",
        "protection_from_energy"
      ],
      "7": [
        "freedom_of_movement",
        "summon_construct"
      ],
      "9": [
        "greater_restoration",
        "wall_of_force"
      ]
    }
  },
  {
    "id": "lunar_sorcery",
    "classId": "sorcerer",
    "name": "Lunar Sorcery",
    "source": "odm",
    "aliases": [
      "lunar sorcery",
      "lunar-sorcery",
      "moon sorcerer"
    ],
    "desc": "A sorcerer whose magic waxes and wanes with a moon phase they can choose at will.",
    "features": {
      "1": [
        {
          "name": "Lunar Embodiment",
          "text": "A rotating set of moon spells always known, and healing or damaging sorcerer spells you cast can shift to radiant or cold."
        },
        {
          "name": "Moon Fire",
          "text": "A bonus action changes your lunar phase: Full grants a radiant aura, New grants concealment, Crescent grants extra reach and movement."
        }
      ],
      "6": [
        {
          "name": "Lunar Boons",
          "text": "Your current phase empowers a matching school of spells, and a sorcery point can shift the phase mid-fight."
        }
      ],
      "14": [
        {
          "name": "Waxing and Waning",
          "text": "Spend sorcery points to shift phase as a free action and add your Charisma modifier to a lunar spell's damage or healing once per turn."
        }
      ],
      "18": [
        {
          "name": "Lunar Phenomenon",
          "text": "Once per long rest or for 5 sorcery points, unleash the full power of your phase in a 30-foot burst that heals allies, blinds enemies or hastens you depending on the moon."
        }
      ]
    }
  },
  {
    "id": "archfey",
    "classId": "warlock",
    "name": "The Archfey",
    "source": "odm",
    "aliases": [
      "archfey",
      "the-archfey",
      "fey patron"
    ],
    "desc": "A pact with a lord or lady of the Feywild: charm, illusion and very sharp bargains.",
    "features": {
      "1": [
        {
          "name": "Fey Presence",
          "text": "An action charms or frightens every creature in a 10-foot cube that fails a Wisdom save until the end of your next turn; recharges on a short or long rest."
        }
      ],
      "6": [
        {
          "name": "Misty Escape",
          "text": "A reaction on taking damage turns you invisible and teleports you 60 feet; recharges on a short or long rest."
        }
      ],
      "10": [
        {
          "name": "Beguiling Defenses",
          "text": "Immunity to being charmed, and a reaction turns a charm attempt back on the caster for 1 minute and 3d10 psychic damage per turn."
        }
      ],
      "14": [
        {
          "name": "Dark Delirium",
          "text": "Wrap a creature within 60 feet in illusion for a minute: charmed or frightened, unable to perceive anything else, and removable to the Feywild until the effect ends."
        }
      ]
    },
    "spells": {
      "1": [
        "faerie_fire",
        "sleep"
      ],
      "3": [
        "calm_emotions",
        "phantasmal_force"
      ],
      "5": [
        "blink",
        "plant_growth"
      ],
      "7": [
        "dominate_beast",
        "greater_invisibility"
      ],
      "9": [
        "dominate_person",
        "seeming"
      ]
    }
  },
  {
    "id": "great_old_one",
    "classId": "warlock",
    "name": "The Great Old One",
    "source": "odm",
    "aliases": [
      "great old one",
      "the-great-old-one",
      "goo"
    ],
    "desc": "A pact with something vast and probably unaware of you, paid in telepathy and madness.",
    "features": {
      "1": [
        {
          "name": "Awakened Mind",
          "text": "Speak telepathically to any creature within 30 feet that shares a language with you."
        }
      ],
      "6": [
        {
          "name": "Entropic Ward",
          "text": "A reaction imposes disadvantage on an attack against you, and a miss grants advantage on your next attack against that creature; recharges on a short or long rest."
        }
      ],
      "10": [
        {
          "name": "Thought Shield",
          "text": "Your thoughts cannot be read, you resist psychic damage, and psychic damage dealt to you is dealt back to the attacker."
        }
      ],
      "14": [
        {
          "name": "Create Thrall",
          "text": "An incapacitated humanoid you touch becomes charmed until a remove curse, with telepathic contact at any distance on the same plane."
        }
      ]
    },
    "spells": {
      "1": [
        "dissonant_whispers",
        "tashas_hideous_laughter"
      ],
      "3": [
        "detect_thoughts",
        "phantasmal_force"
      ],
      "5": [
        "clairvoyance",
        "sending"
      ],
      "7": [
        "dominate_beast",
        "evards_black_tentacles"
      ],
      "9": [
        "dominate_person",
        "telekinesis"
      ]
    }
  },
  {
    "id": "celestial",
    "classId": "warlock",
    "name": "The Celestial",
    "source": "odm",
    "aliases": [
      "celestial",
      "the-celestial"
    ],
    "desc": "A pact with a being of the Upper Planes: radiant fire in one hand, healing light in the other.",
    "features": {
      "1": [
        {
          "name": "Bonus Cantrips (Celestial)",
          "text": "You know light and sacred flame."
        },
        {
          "name": "Healing Light",
          "text": "A pool of d6s equal to 1 + your warlock level, spendable as a bonus action to heal a creature within 60 feet; refills on a long rest."
        }
      ],
      "6": [
        {
          "name": "Radiant Soul",
          "text": "Resistance to radiant damage, and once per turn add your Charisma modifier to a radiant or fire spell's damage."
        }
      ],
      "10": [
        {
          "name": "Celestial Resilience",
          "text": "Temporary hit points after every rest, for you and up to five allies, equal to your warlock level plus your Charisma modifier."
        }
      ],
      "14": [
        {
          "name": "Searing Vengeance",
          "text": "When you would make a death save, rise instead at half hit points, blinding and burning enemies within 30 feet for 2d8 + Charisma radiant damage; recharges on a long rest."
        }
      ]
    },
    "spells": {
      "1": [
        "cure_wounds",
        "guiding_bolt"
      ],
      "3": [
        "flaming_sphere",
        "lesser_restoration"
      ],
      "5": [
        "daylight",
        "revivify"
      ],
      "7": [
        "guardian_of_faith",
        "wall_of_fire"
      ],
      "9": [
        "flame_strike",
        "greater_restoration"
      ]
    }
  },
  {
    "id": "hexblade",
    "classId": "warlock",
    "name": "The Hexblade",
    "source": "odm",
    "aliases": [
      "hexblade",
      "the-hexblade"
    ],
    "desc": "A pact with a sentient weapon from the Shadowfell: a warlock who fights in armor, with a blade.",
    "features": {
      "1": [
        {
          "name": "Hexblade's Curse",
          "text": "A bonus action curses a creature for a minute: bonus damage equal to your proficiency bonus, critical hits on a 19 or 20, and hit points back when it dies; recharges on a short or long rest."
        },
        {
          "name": "Hex Warrior",
          "text": "Proficiency with medium armor, shields and martial weapons, and one weapon each day uses Charisma for attack and damage."
        }
      ],
      "6": [
        {
          "name": "Accursed Specter",
          "text": "A humanoid you kill rises as a specter under your command until your next long rest; recharges on a long rest."
        }
      ],
      "10": [
        {
          "name": "Armor of Hexes",
          "text": "An attack from your cursed target misses on a coin-flip d6 roll even when it would hit."
        }
      ],
      "14": [
        {
          "name": "Master of Hexes",
          "text": "When your cursed target dies, move the curse to a new creature without spending a rest."
        }
      ]
    },
    "spells": {
      "1": [
        "shield",
        "wrathful_smite"
      ],
      "3": [
        "blur",
        "branding_smite"
      ],
      "5": [
        "blink",
        "elemental_weapon"
      ],
      "7": [
        "phantasmal_killer",
        "staggering_smite"
      ],
      "9": [
        "banishing_smite",
        "cone_of_cold"
      ]
    }
  },
  {
    "id": "fathomless",
    "classId": "warlock",
    "name": "The Fathomless",
    "source": "odm",
    "aliases": [
      "fathomless",
      "the-fathomless"
    ],
    "desc": "A pact with something in the deep water, which sends a tentacle when called.",
    "features": {
      "1": [
        {
          "name": "Tentacle of the Deep",
          "text": "A bonus action summons a spectral tentacle for a minute that attacks for 1d8 cold damage and halves a target's speed; a proficiency-bonus number of times per long rest."
        },
        {
          "name": "Gift of the Sea",
          "text": "A 40-foot swimming speed and the ability to breathe underwater."
        }
      ],
      "6": [
        {
          "name": "Oceanic Soul",
          "text": "Immunity to cold damage, full immersion comfort, and the ability to speak with any creature underwater."
        },
        {
          "name": "Guardian Coil",
          "text": "Your tentacle reduces damage to you or a creature near it by 1d8, rising to 2d8 at 10th level."
        }
      ],
      "10": [
        {
          "name": "Grasping Tentacles",
          "text": "You always have evard's black tentacles prepared, gain temporary hit points when you cast it, and keep concentration through damage more easily."
        }
      ],
      "14": [
        {
          "name": "Fathomless Plunge",
          "text": "Teleport yourself and up to five willing creatures to a body of water within a mile; recharges on a short or long rest."
        }
      ]
    },
    "spells": {
      "1": [
        "create_or_destroy_water",
        "thunderwave"
      ],
      "3": [
        "gust_of_wind",
        "silence"
      ],
      "5": [
        "lightning_bolt",
        "sleet_storm"
      ],
      "7": [
        "control_water",
        "summon_elemental"
      ],
      "9": [
        "cone_of_cold",
        "commune_with_nature"
      ]
    }
  },
  {
    "id": "genie",
    "classId": "warlock",
    "name": "The Genie",
    "source": "odm",
    "aliases": [
      "genie",
      "the-genie"
    ],
    "desc": "A pact with a noble genie, carrying their element and a vessel you can climb inside.",
    "features": {
      "1": [
        {
          "name": "Genie's Vessel",
          "text": "A vessel tied to your patron: once per long rest, Bottled Respite lets you retreat inside it for 10 minutes, and Genie's Wrath adds your proficiency bonus in your patron's damage type to one hit per turn."
        }
      ],
      "6": [
        {
          "name": "Elemental Gift",
          "text": "Resistance to your patron's damage type, and a bonus action grants a 30-foot flying speed for 10 minutes, a proficiency-bonus number of times per long rest."
        }
      ],
      "10": [
        {
          "name": "Sanctuary Vessel",
          "text": "Bottled Respite takes up to five companions with you, and everyone who finishes a short rest inside gains temporary hit points."
        }
      ],
      "14": [
        {
          "name": "Limited Wish",
          "text": "Once per 1d4 long rests, replicate any spell of 6th level or lower without components."
        }
      ]
    },
    "spells": {
      "1": [
        "detect_evil_and_good",
        "protection_from_evil_and_good"
      ],
      "3": [
        "phantasmal_force",
        "gust_of_wind"
      ],
      "5": [
        "create_food_and_water",
        "phantom_steed"
      ],
      "7": [
        "arcane_eye",
        "fire_shield"
      ],
      "9": [
        "creation",
        "seeming"
      ]
    }
  },
  {
    "id": "undead",
    "classId": "warlock",
    "name": "The Undead",
    "source": "odm",
    "aliases": [
      "undead patron",
      "the-undead"
    ],
    "desc": "A pact with a lich or worse: the warlock becomes a little more like their patron each level.",
    "features": {
      "1": [
        {
          "name": "Form of Dread",
          "text": "A bonus action for a minute grants temporary hit points of 1d10 + warlock level, immunity to fear, and the power to frighten one creature you hit each turn; a proficiency-bonus number of times per long rest."
        }
      ],
      "6": [
        {
          "name": "Grave Touched",
          "text": "You need no food, drink or air, and once per turn a damaging attack can deal necrotic damage instead, with a bonus die while in Form of Dread."
        }
      ],
      "10": [
        {
          "name": "Necrotic Husk",
          "text": "Immunity to necrotic damage, and once per long rest dropping to 0 hit points instead leaves you at 1 and blasts nearby creatures for necrotic damage equal to your warlock level."
        }
      ],
      "14": [
        {
          "name": "Spirit Projection",
          "text": "For an hour, project your spirit: resistance to most damage, the ability to move through solid matter, and necrotic and psychic spell damage that heals you; once per long rest or with a 5th-level slot."
        }
      ]
    },
    "spells": {
      "1": [
        "false_life",
        "ray_of_sickness"
      ],
      "3": [
        "blindness_deafness",
        "phantasmal_force"
      ],
      "5": [
        "phantom_steed",
        "speak_with_dead"
      ],
      "7": [
        "death_ward",
        "greater_invisibility"
      ],
      "9": [
        "antilife_shell",
        "cloudkill"
      ]
    }
  },
  {
    "id": "undying",
    "classId": "warlock",
    "name": "The Undying",
    "source": "odm",
    "aliases": [
      "undying",
      "the-undying"
    ],
    "desc": "A pact with a deathless being that has cheated the grave and shares the trick.",
    "features": {
      "1": [
        {
          "name": "Among the Dead",
          "text": "You know spare the dying, undead have disadvantage attacking you unless you attack them, and you have advantage on saves against disease."
        }
      ],
      "6": [
        {
          "name": "Defy Death",
          "text": "Regain 1d8 + your Constitution modifier hit points when you succeed on a death save or stabilize a creature; recharges on a long rest."
        }
      ],
      "10": [
        {
          "name": "Undying Nature",
          "text": "You barely need to breathe, eat or sleep, you no longer age, and you cannot be aged magically."
        }
      ],
      "14": [
        {
          "name": "Indestructible Life",
          "text": "A bonus action heals 1d8 + your warlock level and reattaches severed body parts; recharges on a short or long rest."
        }
      ]
    },
    "spells": {
      "1": [
        "false_life",
        "ray_of_sickness"
      ],
      "3": [
        "blindness_deafness",
        "silence"
      ],
      "5": [
        "feign_death",
        "speak_with_dead"
      ],
      "7": [
        "aura_of_life",
        "death_ward"
      ],
      "9": [
        "contagion",
        "legend_lore"
      ]
    }
  },
  {
    "id": "abjuration",
    "classId": "wizard",
    "name": "School of Abjuration",
    "source": "odm",
    "aliases": [
      "abjuration",
      "abjurer",
      "school-of-abjuration"
    ],
    "desc": "A wizard who specializes in wards and counters, carrying a rechargeable magical shield.",
    "features": {
      "2": [
        {
          "name": "Abjuration Savant",
          "text": "Copying abjuration spells into your book costs half the time and gold."
        },
        {
          "name": "Arcane Ward",
          "text": "Casting an abjuration spell of 1st level or higher raises a ward with hit points equal to twice your wizard level plus your Intelligence modifier, which absorbs damage aimed at you and recharges as you cast."
        }
      ],
      "6": [
        {
          "name": "Projected Ward",
          "text": "A reaction makes your Arcane Ward absorb damage aimed at a creature within 30 feet."
        }
      ],
      "10": [
        {
          "name": "Improved Abjuration",
          "text": "Add your proficiency bonus to ability checks made as part of an abjuration spell, such as counterspell and dispel magic."
        }
      ],
      "14": [
        {
          "name": "Spell Resistance",
          "text": "Advantage on saves against spells, and resistance to damage from spells."
        }
      ]
    }
  },
  {
    "id": "conjuration",
    "classId": "wizard",
    "name": "School of Conjuration",
    "source": "odm",
    "aliases": [
      "conjuration",
      "conjurer",
      "school-of-conjuration"
    ],
    "desc": "A wizard who makes things appear: objects, allies, and themselves somewhere safer.",
    "features": {
      "2": [
        {
          "name": "Conjuration Savant",
          "text": "Copying conjuration spells into your book costs half the time and gold."
        },
        {
          "name": "Minor Conjuration",
          "text": "An action conjures a nonmagical object up to 3 feet on a side and 10 pounds for an hour."
        }
      ],
      "6": [
        {
          "name": "Benign Transposition",
          "text": "Teleport 30 feet or swap places with a willing creature; recharges on a long rest or when you cast a conjuration spell."
        }
      ],
      "10": [
        {
          "name": "Focused Conjuration",
          "text": "Concentration on a conjuration spell cannot be broken by taking damage."
        }
      ],
      "14": [
        {
          "name": "Durable Summons",
          "text": "Creatures you summon get 30 temporary hit points."
        }
      ]
    }
  },
  {
    "id": "divination",
    "classId": "wizard",
    "name": "School of Divination",
    "source": "odm",
    "aliases": [
      "divination",
      "diviner",
      "school-of-divination"
    ],
    "desc": "A wizard who reads the future well enough to swap out the dice they do not like.",
    "features": {
      "2": [
        {
          "name": "Divination Savant",
          "text": "Copying divination spells into your book costs half the time and gold."
        },
        {
          "name": "Portent",
          "text": "Roll two d20s after each long rest and replace any attack, check or save made by you or a creature you can see with one of them; three dice from 14th level."
        }
      ],
      "6": [
        {
          "name": "Expert Divination",
          "text": "Casting a divination spell of 2nd level or higher returns one expended slot of lower level."
        }
      ],
      "10": [
        {
          "name": "The Third Eye",
          "text": "After a rest, gain darkvision, ethereal sight, greater comprehension or see invisibility until your next rest."
        }
      ],
      "14": [
        {
          "name": "Greater Portent",
          "text": "You roll three Portent dice after each long rest instead of two."
        }
      ]
    }
  },
  {
    "id": "enchantment",
    "classId": "wizard",
    "name": "School of Enchantment",
    "source": "odm",
    "aliases": [
      "enchantment",
      "enchanter",
      "school-of-enchantment"
    ],
    "desc": "A wizard who works on minds: charm, compulsion, and making an enemy forget which side they are on.",
    "features": {
      "2": [
        {
          "name": "Enchantment Savant",
          "text": "Copying enchantment spells into your book costs half the time and gold."
        },
        {
          "name": "Hypnotic Gaze",
          "text": "An action charms and incapacitates a creature within 5 feet until the end of your next turn, extendable each turn; recharges on a short or long rest."
        }
      ],
      "6": [
        {
          "name": "Instinctive Charm",
          "text": "A reaction redirects an attack aimed at you onto another creature within the attacker's reach on a failed Wisdom save; recharges on a short or long rest."
        }
      ],
      "10": [
        {
          "name": "Split Enchantment",
          "text": "An enchantment spell of 1st level or higher that targets one creature can target a second."
        }
      ],
      "14": [
        {
          "name": "Alter Memories",
          "text": "A charmed creature forgets it was charmed, and you can strip up to your Charisma modifier plus one hour of memory on a failed save."
        }
      ]
    }
  },
  {
    "id": "illusion",
    "classId": "wizard",
    "name": "School of Illusion",
    "source": "odm",
    "aliases": [
      "illusion",
      "illusionist",
      "school-of-illusion"
    ],
    "desc": "A wizard who wins by making the battlefield disagree with everyone else's senses.",
    "features": {
      "2": [
        {
          "name": "Illusion Savant",
          "text": "Copying illusion spells into your book costs half the time and gold."
        },
        {
          "name": "Improved Minor Illusion",
          "text": "You know minor illusion and can create sound and an image with the same casting."
        }
      ],
      "6": [
        {
          "name": "Malleable Illusion",
          "text": "An action reshapes an illusion you are concentrating on while it lasts."
        }
      ],
      "10": [
        {
          "name": "Illusory Self",
          "text": "A reaction interposes an illusory duplicate so an attack that would hit you misses; recharges on a short or long rest."
        }
      ],
      "14": [
        {
          "name": "Illusory Reality",
          "text": "A bonus action makes one object in your illusion real for a minute."
        }
      ]
    }
  },
  {
    "id": "necromancy",
    "classId": "wizard",
    "name": "School of Necromancy",
    "source": "odm",
    "aliases": [
      "necromancy",
      "necromancer",
      "school-of-necromancy"
    ],
    "desc": "A wizard who studies the boundary of life and death, and keeps a retinue on the far side of it.",
    "features": {
      "2": [
        {
          "name": "Necromancy Savant",
          "text": "Copying necromancy spells into your book costs half the time and gold."
        },
        {
          "name": "Grim Harvest",
          "text": "Once per turn, killing a creature with a spell of 1st level or higher restores twice the spell's level in hit points, three times for necromancy spells."
        }
      ],
      "6": [
        {
          "name": "Undead Thralls",
          "text": "You learn animate dead, raise one extra corpse per casting, and your undead gain extra hit points and add your proficiency bonus to weapon damage."
        }
      ],
      "10": [
        {
          "name": "Inured to Undeath",
          "text": "Resistance to necrotic damage, and your hit point maximum cannot be reduced."
        }
      ],
      "14": [
        {
          "name": "Command Undead",
          "text": "An action takes control of an undead creature on a failed Charisma save, with intelligent undead getting a fresh save each time they take damage."
        }
      ]
    }
  },
  {
    "id": "transmutation",
    "classId": "wizard",
    "name": "School of Transmutation",
    "source": "odm",
    "aliases": [
      "transmutation",
      "transmuter",
      "school-of-transmutation"
    ],
    "desc": "A wizard who changes what things are: matter, shape, and eventually the limits of the body.",
    "features": {
      "2": [
        {
          "name": "Transmutation Savant",
          "text": "Copying transmutation spells into your book costs half the time and gold."
        },
        {
          "name": "Minor Alchemy",
          "text": "Ten minutes of concentration converts one material into another, such as wood into stone, for an hour."
        }
      ],
      "6": [
        {
          "name": "Transmuter's Stone",
          "text": "Craft a stone granting one of darkvision, 10 feet of speed, proficiency in Constitution saves, or resistance to an element, changeable when you cast a transmutation spell."
        }
      ],
      "10": [
        {
          "name": "Shapechanger",
          "text": "You always have polymorph prepared and can cast it on yourself as a beast of CR 1 or lower without a slot, once per short or long rest."
        }
      ],
      "14": [
        {
          "name": "Master Transmuter",
          "text": "Destroy your Transmuter's Stone to transform an object, remove all curses and disease from a creature, restore a creature's youth, or raise the dead."
        }
      ]
    }
  },
  {
    "id": "war_magic",
    "classId": "wizard",
    "name": "War Magic",
    "source": "odm",
    "aliases": [
      "war mage",
      "school-of-war-magic",
      "war magic wizard"
    ],
    "desc": "A battle wizard who blends abjuration and evocation into a fighting style of shields and volleys.",
    "features": {
      "2": [
        {
          "name": "Arcane Deflection",
          "text": "A reaction after being hit or failing a save grants +2 AC or +4 on the save, at the cost of casting only cantrips on your next turn."
        },
        {
          "name": "Tactical Wit",
          "text": "Add your Intelligence modifier to initiative."
        }
      ],
      "6": [
        {
          "name": "Power Surge",
          "text": "Store surges from dispelled or countered spells, up to your Intelligence modifier, and spend one to add half your wizard level to a damaging spell's damage."
        }
      ],
      "10": [
        {
          "name": "Durable Magic",
          "text": "While concentrating on a spell, gain +2 AC and +2 on all saving throws."
        }
      ],
      "14": [
        {
          "name": "Deflecting Shroud",
          "text": "Arcane Deflection also deals half your wizard level in force damage to up to three creatures within 60 feet."
        }
      ]
    }
  },
  {
    "id": "bladesinging",
    "classId": "wizard",
    "name": "Bladesinging",
    "source": "odm",
    "aliases": [
      "bladesinger",
      "bladesinging",
      "school-of-bladesinging"
    ],
    "desc": "An elven tradition of sword-dance and spell, trading a heavy spellbook for footwork.",
    "features": {
      "2": [
        {
          "name": "Training in War and Song",
          "text": "Proficiency with light armor, one one-handed melee weapon, and the Performance skill."
        },
        {
          "name": "Bladesong",
          "text": "A bonus action for a minute grants +Intelligence to AC, 10 feet of speed, advantage on Acrobatics and a concentration-save bonus; a proficiency-bonus number of times per long rest."
        }
      ],
      "6": [
        {
          "name": "Extra Attack",
          "text": "Attack twice with the Attack action, and one of those attacks may be a cantrip with a casting time of one action."
        }
      ],
      "10": [
        {
          "name": "Song of Defense",
          "text": "A reaction while bladesinging spends a spell slot to reduce damage to you by five times the slot level."
        }
      ],
      "14": [
        {
          "name": "Song of Victory",
          "text": "Add your Intelligence modifier to melee weapon damage while bladesinging."
        }
      ]
    }
  },
  {
    "id": "chronurgy_magic",
    "classId": "wizard",
    "name": "Chronurgy Magic",
    "source": "odm",
    "aliases": [
      "chronurgy",
      "chronurgist",
      "chronurgy-magic"
    ],
    "desc": "A wizard of Wildemount who manipulates time itself: initiative, durations and dice.",
    "features": {
      "2": [
        {
          "name": "Chronal Shift",
          "text": "A reaction forces a creature within 30 feet to reroll an attack, check or save, twice per long rest."
        },
        {
          "name": "Temporal Awareness",
          "text": "Add your Intelligence modifier to initiative."
        }
      ],
      "6": [
        {
          "name": "Momentary Stasis",
          "text": "A Large or smaller creature within 60 feet is frozen in time until the end of your next turn on a failed Constitution save; a proficiency-bonus number of times per long rest."
        }
      ],
      "10": [
        {
          "name": "Arcane Abeyance",
          "text": "Store a spell of 4th level or lower in a bead that anyone can break to cast it; recharges on a short or long rest."
        }
      ],
      "14": [
        {
          "name": "Convergent Future",
          "text": "A reaction dictates the outcome of a roll within 60 feet as a success or a failure, at the cost of a level of exhaustion."
        }
      ]
    }
  },
  {
    "id": "graviturgy_magic",
    "classId": "wizard",
    "name": "Graviturgy Magic",
    "source": "odm",
    "aliases": [
      "graviturgy",
      "graviturgist",
      "graviturgy-magic"
    ],
    "desc": "A wizard of Wildemount who bends weight and gravity, crushing, slowing and hurling.",
    "features": {
      "2": [
        {
          "name": "Adjust Density",
          "text": "Halve or double a creature's or object's weight for a minute, changing its speed, carrying capacity and Strength checks."
        }
      ],
      "6": [
        {
          "name": "Gravity Well",
          "text": "Any creature you affect with a spell can be moved 5 feet to a space of your choice."
        }
      ],
      "10": [
        {
          "name": "Violent Attraction",
          "text": "A reaction adds 1d10 to a falling or weapon damage roll within 60 feet, a proficiency-bonus number of times per long rest."
        }
      ],
      "14": [
        {
          "name": "Event Horizon",
          "text": "A 30-foot field of crushing gravity for a minute that deals 2d10 force damage and halts movement on a failed Strength save; once per long rest or with a 4th-level slot."
        }
      ]
    }
  },
  {
    "id": "scribes",
    "classId": "wizard",
    "name": "Order of Scribes",
    "source": "odm",
    "aliases": [
      "scribes",
      "order-of-scribes",
      "scribe wizard"
    ],
    "desc": "A wizard whose spellbook wakes up and starts talking, and whose spells can change their element.",
    "features": {
      "2": [
        {
          "name": "Wizardly Quill",
          "text": "Conjure a magic quill that needs no ink, scribes at speed, and can erase what it wrote."
        },
        {
          "name": "Awakened Spellbook",
          "text": "Your book gains a mind: it lets you change a spell's damage type, cast one ritual per long rest without preparing it, and replace lost pages."
        }
      ],
      "6": [
        {
          "name": "Manifest Mind",
          "text": "A bonus action projects your book's spirit up to 300 feet, letting you cast spells from its position and shed light; free once per long rest, otherwise a slot."
        }
      ],
      "10": [
        {
          "name": "Master Scrivener",
          "text": "After a long rest, create a spell scroll of a 1st or 2nd-level spell from your book, cast at maximum effect."
        }
      ],
      "14": [
        {
          "name": "One with the Word",
          "text": "Once per long rest, avoid death by destroying your book's magic, then rebuild it over days of study."
        }
      ]
    }
  }
];
