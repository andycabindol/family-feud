import { builtInPack } from './compact';

// Deliberately broad, household-name pop culture only.
export const popculture = builtInPack(
  'popculture',
  'Pop Culture',
  'Movies, music, TV, and phones - only the stuff everyone knows.',
  [
    `Name a superhero | Movies | e | Superman:26 ; Batman:24 ; Spider-Man:20:spiderman ; Iron Man:8 ; Wonder Woman:7 ; Hulk:5:the hulk ; Captain America:4`,
    `Name a Disney movie | Movies | e | The Lion King:22:lion king ; Frozen:20 ; Cinderella:12 ; Moana:10 ; Aladdin:10 ; Snow White:8 ; Toy Story:8:toy story`,
    `Name a social media app | Technology | e | Facebook:28 ; Instagram:24:insta ; TikTok:16:tik tok ; Twitter:12:x ; Snapchat:10:snap ; YouTube:6 ; Pinterest:4`,
    `Name a streaming service | Technology | e | Netflix:38 ; Hulu:16 ; Disney Plus:14:disney+ ; Amazon Prime:12:prime video,prime ; HBO Max:8:max,hbo ; YouTube:6 ; Peacock:4`,
    `Name a famous cartoon character | TV | e | Mickey Mouse:24:mickey ; Bugs Bunny:18 ; Homer Simpson:12:homer,bart simpson ; SpongeBob:12:spongebob squarepants ; Scooby-Doo:10:scooby doo,scooby ; Tom or Jerry:8:tom,jerry ; Donald Duck:6`,
    `Name something you do on a smartphone | Technology | e | Text:28:send texts,texting ; Take Pictures:20:photos,camera,take photos ; Make Calls:16:call,phone call ; Social Media:12:facebook,instagram,scroll ; Play Games:10:games ; Check Email:8:email ; Use GPS:4:maps,directions`,
    `Name a type of movie | Movies | e | Comedy:28:funny ; Horror:18:scary ; Action:16 ; Romance:14:romantic,love story ; Drama:8 ; Cartoon:6:animated,animation ; Western:4`,
    `Name a famous singer | Music | e | Taylor Swift:22 ; Elvis Presley:18:elvis ; Beyonce:14 ; Michael Jackson:12 ; Frank Sinatra:10:sinatra ; Madonna:8 ; Whitney Houston:6`,
    `Name a board game | Games | e | Monopoly:26 ; Scrabble:16 ; Clue:14:cluedo ; Chess:12 ; Checkers:10 ; Candy Land:8 ; Sorry:6`,
    `Name something you see at a movie theater | Movies | e | Popcorn:32 ; Big Screen:18:screen,the movie ; Previews:14:trailers,commercials ; Candy:10:snacks ; Soda:8:drinks ; Seats:8:chairs,recliners ; Ticket Booth:6:tickets`,
    `Name a fairy tale character | Stories | e | Cinderella:22 ; Snow White:18 ; Little Red Riding Hood:14:red riding hood ; Goldilocks:12 ; Hansel and Gretel:10:hansel,gretel ; Sleeping Beauty:8 ; Rapunzel:6`,
    `Name a TV show families watch together | TV | m | The Simpsons:20:simpsons ; Jeopardy:14:jeopardy! ; Wheel of Fortune:12 ; Family Feud:12 ; America's Got Talent:10 ; Modern Family:8 ; Football:6:sports,nfl`,
    `Name a video game character | Games | e | Mario:38:super mario ; Sonic:16:sonic the hedgehog ; Luigi:10 ; Pac-Man:10:pacman ; Link:6:zelda ; Pikachu:6:pokemon ; Donkey Kong:4`,
    `Name a toy people played with as a kid | Toys | e | Barbie:22:barbie doll ; Legos:20:lego ; Teddy Bear:14:stuffed animal ; Hot Wheels:12:toy cars,cars ; Play-Doh:10:play doh ; Etch A Sketch:6 ; Yo-Yo:4`,
    `Name a holiday movie character | Movies | e | Santa:30:santa claus ; Grinch:20:the grinch ; Rudolph:14 ; Frosty:12:frosty the snowman ; Buddy the Elf:8:buddy ; Kevin McCallister:6:kevin ; Scrooge:4`,
    `Name a musical instrument | Music | e | Guitar:30 ; Piano:26:keyboard ; Drums:14:drum ; Violin:10:fiddle ; Trumpet:6 ; Saxophone:5:sax ; Flute:4`,
  ],
);
